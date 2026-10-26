import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryBoardRepository } from './in-memory-board.repository.js';
import {
  MaxColumnsReachedError,
  LastColumnDeletionError,
  BoardColumnNotFoundError,
} from '@is488/shared';

describe('InMemoryBoardRepository', () => {
  let repository: InMemoryBoardRepository;
  const projectId = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    repository = new InMemoryBoardRepository();
  });

  it('creates a default board with 3 canonical columns when none exists', async () => {
    const board = await repository.findOrCreateDefaultBoard(projectId);

    expect(board.id).toBeDefined();
    expect(board.projectId).toBe(projectId);
    expect(board.columns).toHaveLength(3);
    expect(board.columns[0]).toMatchObject({ name: 'Por hacer', category: 'TODO', orderIndex: 0 });
    expect(board.columns[1]).toMatchObject({
      name: 'En progreso',
      category: 'IN_PROGRESS',
      orderIndex: 1,
    });
    expect(board.columns[2]).toMatchObject({ name: 'Completado', category: 'DONE', orderIndex: 2 });
  });

  it('returns the same board idempotently on sequential and concurrent invocations', async () => {
    const [b1, b2, b3] = await Promise.all([
      repository.findOrCreateDefaultBoard(projectId),
      repository.findOrCreateDefaultBoard(projectId),
      repository.findOrCreateDefaultBoard(projectId),
    ]);

    expect(b1.id).toBe(b2.id);
    expect(b2.id).toBe(b3.id);
    expect(b1.columns).toHaveLength(3);
  });

  it('adds columns sequentially and assigns orderIndex', async () => {
    const board = await repository.findOrCreateDefaultBoard(projectId);
    const newCol = await repository.addColumn(board.id, {
      boardId: board.id,
      name: 'En revisión',
      category: 'IN_REVIEW',
      orderIndex: 3,
    });

    expect(newCol.id).toBeDefined();
    expect(newCol.orderIndex).toBe(3);

    const updated = await repository.findById(board.id);
    expect(updated?.columns).toHaveLength(4);
  });

  it('rejects adding more than 10 columns with MaxColumnsReachedError', async () => {
    const board = await repository.findOrCreateDefaultBoard(projectId);
    for (let i = 3; i < 10; i++) {
      await repository.addColumn(board.id, {
        boardId: board.id,
        name: `Columna ${i + 1}`,
        category: 'TODO',
        orderIndex: i,
      });
    }

    const current = await repository.findById(board.id);
    expect(current?.columns).toHaveLength(10);

    await expect(
      repository.addColumn(board.id, {
        boardId: board.id,
        name: 'Undécima columna',
        category: 'TODO',
        orderIndex: 10,
      }),
    ).rejects.toThrow(MaxColumnsReachedError);
  });

  it('updates an existing column and throws 404 if not found', async () => {
    const board = await repository.findOrCreateDefaultBoard(projectId);
    const colToUpdate = board.columns[0]!;

    const updated = await repository.updateColumn(colToUpdate.id, {
      name: 'Tareas pendientes',
      color: '#f59e0b',
    });

    expect(updated.name).toBe('Tareas pendientes');
    expect(updated.color).toBe('#f59e0b');

    await expect(
      repository.updateColumn('00000000-0000-0000-0000-000000000000', { name: 'X' }),
    ).rejects.toThrow(BoardColumnNotFoundError);
  });

  it('deletes a column and recompacts remaining order indices', async () => {
    const board = await repository.findOrCreateDefaultBoard(projectId);
    const middleCol = board.columns[1]!;

    await repository.deleteColumn(middleCol.id);

    const updated = await repository.findById(board.id);
    expect(updated?.columns).toHaveLength(2);
    expect(updated?.columns[0]?.orderIndex).toBe(0);
    expect(updated?.columns[1]?.orderIndex).toBe(1);
    expect(updated?.columns[0]?.name).toBe('Por hacer');
    expect(updated?.columns[1]?.name).toBe('Completado');
  });

  it('rejects deletion of the last remaining column with LastColumnDeletionError', async () => {
    const board = await repository.findOrCreateDefaultBoard(projectId);
    await repository.deleteColumn(board.columns[0]!.id);
    await repository.deleteColumn(board.columns[1]!.id);

    const remaining = (await repository.findById(board.id))?.columns ?? [];
    expect(remaining).toHaveLength(1);

    await expect(repository.deleteColumn(remaining[0]!.id)).rejects.toThrow(
      LastColumnDeletionError,
    );
  });

  it('reorders columns correctly according to specified indices', async () => {
    const board = await repository.findOrCreateDefaultBoard(projectId);
    const [c0, c1, c2] = board.columns;
    expect(c0).toBeDefined();
    expect(c1).toBeDefined();
    expect(c2).toBeDefined();

    await repository.reorderColumns(board.id, [
      { columnId: c0!.id, orderIndex: 2 },
      { columnId: c1!.id, orderIndex: 0 },
      { columnId: c2!.id, orderIndex: 1 },
    ]);

    const updated = await repository.findById(board.id);
    expect(updated?.columns[0]?.id).toBe(c1!.id);
    expect(updated?.columns[1]?.id).toBe(c2!.id);
    expect(updated?.columns[2]?.id).toBe(c0!.id);
  });

  it('saveBoard rejects overwriting an existing board without verifiable expected revision', async () => {
    const board = await repository.findOrCreateDefaultBoard(projectId);
    await expect(
      repository.saveBoard({
        ...board,
        updatedAt: new Date(Date.now() + 10000).toISOString(),
      }),
    ).rejects.toThrow(/se requiere una revision esperada verificable/);
  });

  it('saveBoard persists board and rejects overwriting with obsolete state', async () => {
    const board = await repository.findOrCreateDefaultBoard(projectId);
    const rev1 = repository.getBoardRevision(projectId);
    const baseTime = new Date(board.updatedAt).getTime();
    const newerTime = new Date(baseTime + 10000).toISOString();
    const olderTime = new Date(baseTime - 10000).toISOString();

    // Guardar version mas reciente con revision esperada verificable
    await repository.saveBoard(
      {
        ...board,
        updatedAt: newerTime,
      },
      rev1,
    );

    const current = await repository.findByProjectId(projectId);
    expect(current?.updatedAt).toBe(newerTime);

    const rev2 = repository.getBoardRevision(projectId);

    // Intentar sobrescribir con version obsoleta
    await expect(
      repository.saveBoard(
        {
          ...board,
          updatedAt: olderTime,
        },
        rev2,
      ),
    ).rejects.toThrow('Conflicto de concurrencia');
  });

  it('saveBoard rejects conflicting updates when expectedRevision does not match current revision', async () => {
    const board = await repository.findOrCreateDefaultBoard(projectId);
    const rev1 = repository.getBoardRevision(projectId);
    expect(rev1).toBeGreaterThanOrEqual(1);

    // Actualizar una columna para avanzar la revision
    await repository.updateColumn(board.columns[0]!.id, { name: 'Renombrada' });
    const rev2 = repository.getBoardRevision(projectId);
    expect(rev2).toBe(rev1 + 1);

    // Intentar guardar pasando rev1 como revision esperada
    await expect(
      repository.saveBoard({ ...board, updatedAt: new Date().toISOString() }, rev1),
    ).rejects.toThrow(/la revision esperada/);
  });

  it('saveBoard rejects two different states with the exact same timestamp', async () => {
    const board = await repository.findOrCreateDefaultBoard(projectId);
    const fixedTimestamp = new Date(new Date(board.updatedAt).getTime() + 5000).toISOString();

    const stateA = {
      ...board,
      columns: board.columns.map((c, i) => (i === 0 ? { ...c, name: 'Estado A' } : { ...c })),
      updatedAt: fixedTimestamp,
    };

    const stateB = {
      ...board,
      columns: board.columns.map((c, i) => (i === 0 ? { ...c, name: 'Estado B' } : { ...c })),
      updatedAt: fixedTimestamp,
    };

    const rev1 = repository.getBoardRevision(projectId);
    // Guardar estado A con fixedTimestamp y revision esperada verificable
    await repository.saveBoard(stateA, rev1);
    const persisted = await repository.findByProjectId(projectId);
    expect(persisted?.columns[0]?.name).toBe('Estado A');

    const rev2 = repository.getBoardRevision(projectId);
    // Intentar guardar un estado B DIFERENTE con el MISMO timestamp (incluso si proveyera revision correcta)
    await expect(repository.saveBoard(stateB, rev2)).rejects.toThrow(
      /intento de sobrescribir el tablero con un estado diferente con la misma marca temporal/,
    );
  });

  it('updateColumn moves first column to last position and vice versa with exact OpenSpec semantics', async () => {
    const board = await repository.findOrCreateDefaultBoard(projectId);
    const [c0, c1, c2] = board.columns;

    // 1. Mover la primera columna (c0, idx 0) a la última posición (idx 2)
    const movedToLast = await repository.updateColumn(c0!.id, { orderIndex: 2 });
    expect(movedToLast.orderIndex).toBe(2);

    const boardAfterMoveLast = await repository.findById(board.id);
    expect(boardAfterMoveLast?.columns.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
    expect(boardAfterMoveLast?.columns[0]?.id).toBe(c1!.id);
    expect(boardAfterMoveLast?.columns[1]?.id).toBe(c2!.id);
    expect(boardAfterMoveLast?.columns[2]?.id).toBe(c0!.id);

    // 2. Mover la columna (c0, ahora en idx 2) de regreso a la primera posición (idx 0)
    const movedToFirst = await repository.updateColumn(c0!.id, { orderIndex: 0 });
    expect(movedToFirst.orderIndex).toBe(0);

    const boardAfterMoveFirst = await repository.findById(board.id);
    expect(boardAfterMoveFirst?.columns.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
    expect(boardAfterMoveFirst?.columns[0]?.id).toBe(c0!.id);
    expect(boardAfterMoveFirst?.columns[1]?.id).toBe(c1!.id);
    expect(boardAfterMoveFirst?.columns[2]?.id).toBe(c2!.id);
  });

  it('updateColumn recompacts column orderIndex contiguously and uniquely', async () => {
    const board = await repository.findOrCreateDefaultBoard(projectId);
    const firstCol = board.columns[0]!;

    // Mover la primera columna a un orderIndex arbitrario (ej. 10)
    await repository.updateColumn(firstCol.id, {
      orderIndex: 10,
    });

    const updated = await repository.findById(board.id);
    expect(updated?.columns.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
    // La columna modificada ahora quedo al final (posicion 2)
    expect(updated?.columns[2]?.id).toBe(firstCol.id);
  });

  it('reorderColumns recompacts column orderIndex contiguously even with gaps in input', async () => {
    const board = await repository.findOrCreateDefaultBoard(projectId);
    const [c0, c1, c2] = board.columns;

    // Asignar indices con huecos: 50, 10, 30
    await repository.reorderColumns(board.id, [
      { columnId: c0!.id, orderIndex: 50 },
      { columnId: c1!.id, orderIndex: 10 },
      { columnId: c2!.id, orderIndex: 30 },
    ]);

    const updated = await repository.findById(board.id);
    expect(updated?.columns.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
    expect(updated?.columns[0]?.id).toBe(c1!.id);
    expect(updated?.columns[1]?.id).toBe(c2!.id);
    expect(updated?.columns[2]?.id).toBe(c0!.id);
  });
});
