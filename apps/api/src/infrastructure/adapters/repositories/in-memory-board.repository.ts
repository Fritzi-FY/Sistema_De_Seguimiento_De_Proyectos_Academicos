import type { Board, BoardColumn, BoardRepositoryPort } from '@is488/shared';
import {
  BoardNotFoundError,
  BoardColumnNotFoundError,
  MaxColumnsReachedError,
  LastColumnDeletionError,
} from '@is488/shared';
import type { ProjectLockManager } from './in-memory-kanban-project.storage.js';
import { InMemoryKanbanProjectStorage, cloneBoard } from './in-memory-kanban-project.storage.js';

export { ProjectLockManager } from './in-memory-kanban-project.storage.js';

export class InMemoryBoardRepository implements BoardRepositoryPort {
  public readonly storage: InMemoryKanbanProjectStorage;

  constructor(storage?: InMemoryKanbanProjectStorage, lockManager?: ProjectLockManager) {
    this.storage = storage ?? new InMemoryKanbanProjectStorage(lockManager);
  }

  public get lockManager(): ProjectLockManager {
    return this.storage.lockManager;
  }

  async findByProjectId(projectId: string): Promise<Board | null> {
    const snapshot = this.storage.getSnapshot(projectId);
    return snapshot.board ? cloneBoard(snapshot.board) : null;
  }

  async findById(id: string): Promise<Board | null> {
    const lookup = this.storage.findProjectStateByBoardId(id);
    return lookup?.state.board ? cloneBoard(lookup.state.board) : null;
  }

  getBoardRevision(projectId: string): number {
    return this.storage.getBoardRevision(projectId);
  }

  async saveBoard(board: Board, expectedRevision?: number): Promise<void> {
    return this.storage.lockManager.withLock(board.projectId, async () => {
      const snapshot = this.storage.getSnapshot(board.projectId);
      if (snapshot.board) {
        // Exigir revision esperada verificable al sobrescribir un tablero existente
        if (expectedRevision === undefined || typeof expectedRevision !== 'number') {
          throw new Error(
            'Conflicto de concurrencia: se requiere una revision esperada verificable para actualizar un tablero existente',
          );
        }
        if (snapshot.boardRevision !== expectedRevision) {
          throw new Error(
            `Conflicto de concurrencia: la revision esperada (${expectedRevision}) no coincide con la version actual del tablero (${snapshot.boardRevision})`,
          );
        }

        const existingTime = new Date(snapshot.board.updatedAt).getTime();
        const incomingTime = new Date(board.updatedAt).getTime();
        if (existingTime > incomingTime) {
          throw new Error(
            `Conflicto de concurrencia: el tablero ya posee una version mas reciente (${snapshot.board.updatedAt})`,
          );
        }

        // Proteger contra dos estados diferentes con la misma marca temporal
        if (existingTime === incomingTime) {
          const existingSerialized = JSON.stringify(snapshot.board.columns);
          const incomingSerialized = JSON.stringify(board.columns);
          if (existingSerialized !== incomingSerialized) {
            throw new Error(
              `Conflicto de concurrencia: intento de sobrescribir el tablero con un estado diferente con la misma marca temporal (${board.updatedAt})`,
            );
          }
        }
      }
      snapshot.board = cloneBoard(board);
      this.storage.commitSnapshot(board.projectId, snapshot);
    });
  }

  async findOrCreateDefaultBoard(projectId: string): Promise<Board> {
    return this.storage.lockManager.withLock(projectId, async () => {
      const snapshot = this.storage.getSnapshot(projectId);
      if (snapshot.board) {
        return cloneBoard(snapshot.board);
      }

      const boardId = crypto.randomUUID();
      const now = new Date().toISOString();
      const defaultColumns: BoardColumn[] = [
        {
          id: crypto.randomUUID(),
          boardId,
          name: 'Por hacer',
          orderIndex: 0,
          category: 'TODO',
          color: '#64748b',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: crypto.randomUUID(),
          boardId,
          name: 'En progreso',
          orderIndex: 1,
          category: 'IN_PROGRESS',
          color: '#3b82f6',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: crypto.randomUUID(),
          boardId,
          name: 'Completado',
          orderIndex: 2,
          category: 'DONE',
          color: '#10b981',
          createdAt: now,
          updatedAt: now,
        },
      ];

      const newBoard: Board = {
        id: boardId,
        projectId,
        columns: defaultColumns,
        createdAt: now,
        updatedAt: now,
      };

      snapshot.board = newBoard;
      this.storage.commitSnapshot(projectId, snapshot);
      return cloneBoard(newBoard);
    });
  }

  async addColumn(
    boardId: string,
    columnData: Omit<BoardColumn, 'id' | 'createdAt' | 'updatedAt'> & {
      id?: string;
      orderIndex?: number;
    },
  ): Promise<BoardColumn> {
    const lookup = this.storage.findProjectStateByBoardId(boardId);
    if (!lookup || !lookup.state.board) {
      throw Object.assign(new BoardNotFoundError(boardId), { statusCode: 404 });
    }

    return this.storage.lockManager.withLock(lookup.projectId, async () => {
      const snapshot = this.storage.getSnapshot(lookup.projectId);
      const board = snapshot.board;
      if (!board || board.id !== boardId) {
        throw Object.assign(new BoardNotFoundError(boardId), { statusCode: 404 });
      }

      if (board.columns.length >= 10) {
        throw Object.assign(new MaxColumnsReachedError(boardId, 10), { statusCode: 400 });
      }

      const now = new Date().toISOString();
      const newColumn: BoardColumn = {
        id: columnData.id ?? crypto.randomUUID(),
        boardId,
        name: columnData.name,
        orderIndex: columnData.orderIndex ?? board.columns.length,
        category: columnData.category,
        color: columnData.color,
        createdAt: now,
        updatedAt: now,
      };

      const updatedColumns = [...board.columns.map((c) => ({ ...c })), newColumn];
      updatedColumns.sort((a, b) => a.orderIndex - b.orderIndex);
      updatedColumns.forEach((col, idx) => {
        col.orderIndex = idx;
      });

      const updatedBoard: Board = {
        ...board,
        columns: updatedColumns,
        updatedAt: now,
      };

      snapshot.board = updatedBoard;
      this.storage.commitSnapshot(lookup.projectId, snapshot);
      const persistedColumn = updatedColumns.find((c) => c.id === newColumn.id)!;
      return { ...persistedColumn };
    });
  }

  async updateColumn(
    columnId: string,
    updates: Partial<Pick<BoardColumn, 'name' | 'color' | 'category' | 'orderIndex'>>,
  ): Promise<BoardColumn> {
    const lookup = this.storage.findProjectStateByColumnId(columnId);
    if (!lookup) {
      throw Object.assign(new BoardColumnNotFoundError(columnId), { statusCode: 404 });
    }

    return this.storage.lockManager.withLock(lookup.projectId, async () => {
      const snapshot = this.storage.getSnapshot(lookup.projectId);
      const board = snapshot.board;
      if (!board) {
        throw Object.assign(new BoardColumnNotFoundError(columnId), { statusCode: 404 });
      }

      const colIndex = board.columns.findIndex((c) => c.id === columnId);
      if (colIndex === -1) {
        throw Object.assign(new BoardColumnNotFoundError(columnId), { statusCode: 404 });
      }

      const target = board.columns[colIndex]!;
      const now = new Date().toISOString();
      const updatedColumn: BoardColumn = {
        ...target,
        name: updates.name !== undefined ? updates.name : target.name,
        color: updates.color !== undefined ? updates.color : target.color,
        category: updates.category !== undefined ? updates.category : target.category,
        orderIndex: target.orderIndex,
        updatedAt: now,
      };

      let reorderedColumns: BoardColumn[];
      if (updates.orderIndex !== undefined && updates.orderIndex !== target.orderIndex) {
        // Remover la columna de su posicion original
        const otherColumns = board.columns
          .filter((c) => c.id !== columnId)
          .sort((a, b) => a.orderIndex - b.orderIndex);

        // Clampear la nueva posicion entre 0 y el total disponible
        const targetIndex = Math.max(0, Math.min(updates.orderIndex, otherColumns.length));
        otherColumns.splice(targetIndex, 0, updatedColumn);

        // Recompactar indices estrictamente contiguos y unicos 0..n-1
        otherColumns.forEach((col, idx) => {
          col.orderIndex = idx;
        });
        reorderedColumns = otherColumns;
      } else {
        reorderedColumns = board.columns.map((c, idx) =>
          idx === colIndex ? updatedColumn : { ...c },
        );
      }

      const updatedBoard: Board = {
        ...board,
        columns: reorderedColumns,
        updatedAt: now,
      };

      snapshot.board = updatedBoard;
      this.storage.commitSnapshot(lookup.projectId, snapshot);
      const finalColumn = reorderedColumns.find((c) => c.id === columnId)!;
      return { ...finalColumn };
    });
  }

  async deleteColumn(columnId: string): Promise<void> {
    const lookup = this.storage.findProjectStateByColumnId(columnId);
    if (!lookup) {
      throw Object.assign(new BoardColumnNotFoundError(columnId), { statusCode: 404 });
    }

    return this.storage.lockManager.withLock(lookup.projectId, async () => {
      const snapshot = this.storage.getSnapshot(lookup.projectId);
      const board = snapshot.board;
      if (!board) {
        throw Object.assign(new BoardColumnNotFoundError(columnId), { statusCode: 404 });
      }

      const colIndex = board.columns.findIndex((c) => c.id === columnId);
      if (colIndex === -1) {
        throw Object.assign(new BoardColumnNotFoundError(columnId), { statusCode: 404 });
      }

      if (board.columns.length <= 1) {
        throw Object.assign(new LastColumnDeletionError(board.id), { statusCode: 400 });
      }

      const remaining = board.columns
        .filter((c) => c.id !== columnId)
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((col, idx) => ({
          ...col,
          orderIndex: idx,
        }));

      const now = new Date().toISOString();
      const updatedBoard: Board = {
        ...board,
        columns: remaining,
        updatedAt: now,
      };

      snapshot.board = updatedBoard;
      this.storage.commitSnapshot(lookup.projectId, snapshot);
    });
  }

  async reorderColumns(
    boardId: string,
    columnOrders: Array<{ columnId: string; orderIndex: number }>,
  ): Promise<void> {
    const lookup = this.storage.findProjectStateByBoardId(boardId);
    if (!lookup || !lookup.state.board) {
      throw Object.assign(new BoardNotFoundError(boardId), { statusCode: 404 });
    }

    return this.storage.lockManager.withLock(lookup.projectId, async () => {
      const snapshot = this.storage.getSnapshot(lookup.projectId);
      const board = snapshot.board;
      if (!board || board.id !== boardId) {
        throw Object.assign(new BoardNotFoundError(boardId), { statusCode: 404 });
      }

      const orderMap = new Map(columnOrders.map((o) => [o.columnId, o.orderIndex]));
      const updatedColumns = board.columns.map((col) => {
        const newOrder = orderMap.get(col.id);
        return {
          ...col,
          orderIndex: newOrder !== undefined ? newOrder : col.orderIndex,
        };
      });

      updatedColumns.sort((a, b) => a.orderIndex - b.orderIndex);
      // Garantizar que los indices sean estrictamente contiguos y unicos 0..n-1
      updatedColumns.forEach((col, idx) => {
        col.orderIndex = idx;
      });

      const now = new Date().toISOString();
      const updatedBoard: Board = {
        ...board,
        columns: updatedColumns,
        updatedAt: now,
      };

      snapshot.board = updatedBoard;
      this.storage.commitSnapshot(lookup.projectId, snapshot);
    });
  }

  clear(): void {
    this.storage.clear();
  }
}
