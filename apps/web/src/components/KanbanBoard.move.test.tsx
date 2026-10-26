/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { BoardResponse, TaskResponse } from '@is488/shared';

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: React.ReactNode;
    onDragEnd: (event: { active: { id: string }; over: { id: string } | null }) => void;
  }) => {
    return (
      <div>
        <button
          type="button"
          data-testid="trigger-move-to-progress"
          onClick={() => onDragEnd({ active: { id: 'task-1' }, over: { id: 'column-2' } })}
        >
          Mover
        </button>
        {children}
      </div>
    );
  },
  DragOverlay: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  KeyboardSensor: function KeyboardSensor() {},
  PointerSensor: function PointerSensor() {},
  closestCorners: vi.fn(),
  useSensor: vi.fn((sensor) => sensor),
  useSensors: vi.fn((...sensors) => sensors),
}));

vi.mock('@dnd-kit/sortable', () => ({
  sortableKeyboardCoordinates: vi.fn(),
}));

vi.mock('./KanbanColumn.js', () => ({
  KanbanColumn: ({
    column,
    tasks,
  }: {
    column: { id: string; name: string };
    tasks: TaskResponse[];
  }) => (
    <section aria-label={column.name}>
      <span data-testid={`count-${column.id}`}>{tasks.length}</span>
      {tasks
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((task) => (
          <article key={task.id}>{task.title}</article>
        ))}
    </section>
  ),
}));

vi.mock('./CreateTaskModal.js', () => ({
  CreateTaskModal: () => null,
}));

vi.mock('./EditTaskModal.js', () => ({
  EditTaskModal: () => null,
}));

import { KanbanBoard } from './KanbanBoard.js';

describe('KanbanBoard movement integration', () => {
  const projectId = 'project-1';
  const board: BoardResponse = {
    id: 'board-1',
    projectId,
    columns: [
      {
        id: 'column-1',
        boardId: 'board-1',
        name: 'Por hacer',
        orderIndex: 0,
        category: 'TODO',
        createdAt: '2026-10-20T10:00:00.000Z',
        updatedAt: '2026-10-20T10:00:00.000Z',
      },
      {
        id: 'column-2',
        boardId: 'board-1',
        name: 'En progreso',
        orderIndex: 1,
        category: 'IN_PROGRESS',
        createdAt: '2026-10-20T10:00:00.000Z',
        updatedAt: '2026-10-20T10:00:00.000Z',
      },
    ],
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
  };
  const task = (id: string, title: string, columnId: string, orderIndex: number): TaskResponse => ({
    id,
    projectId,
    columnId,
    title,
    priority: 'MEDIUM',
    orderIndex,
    labels: [],
    creatorId: 'user-1',
    assigneeIds: [],
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
  });

  const renderBoard = (
    tasks: TaskResponse[],
    taskMover: (
      projectId: string,
      taskId: string,
      data: { destinationColumnId: string; destinationIndex: number },
    ) => Promise<TaskResponse>,
  ) =>
    render(
      <KanbanBoard
        projectId={projectId}
        boardFetcher={vi.fn().mockResolvedValue(board)}
        tasksFetcher={vi.fn().mockResolvedValue(tasks)}
        taskMover={taskMover}
      />,
    );

  it('reemplaza la tarjeta confirmada sin duplicarla y conserva contadores', async () => {
    const original = task('task-1', 'Tarea original', 'column-1', 0);
    const confirmed = {
      ...original,
      title: 'Tarea confirmada',
      columnId: 'column-2',
      orderIndex: 0,
    };
    const taskMover = vi.fn().mockResolvedValue(confirmed);
    renderBoard([original], taskMover);

    await waitFor(() => expect(screen.getByText('Tarea original')).toBeInTheDocument());
    await act(async () => {
      screen.getByTestId('trigger-move-to-progress').click();
    });

    await waitFor(() => expect(screen.getByText('Tarea confirmada')).toBeInTheDocument());
    expect(screen.getAllByText('Tarea confirmada')).toHaveLength(1);
    expect(screen.getByTestId('count-column-1')).toHaveTextContent('0');
    expect(screen.getByTestId('count-column-2')).toHaveTextContent('1');
    expect(taskMover).toHaveBeenCalledWith(projectId, 'task-1', {
      destinationColumnId: 'column-2',
      destinationIndex: 0,
    });
  });

  it('revierte el movimiento ante error y conserva la tarjeta', async () => {
    const original = task('task-1', 'Tarea original', 'column-1', 0);
    const taskMover = vi.fn().mockRejectedValue(new Error('Fallo controlado'));
    renderBoard([original], taskMover);

    await waitFor(() => expect(screen.getByText('Tarea original')).toBeInTheDocument());
    await act(async () => {
      screen.getByTestId('trigger-move-to-progress').click();
    });

    await waitFor(() => expect(screen.getByTestId('kanban-move-error')).toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'Por hacer' })).toHaveTextContent('Tarea original');
    expect(screen.getByTestId('count-column-1')).toHaveTextContent('1');
    expect(screen.getByTestId('count-column-2')).toHaveTextContent('0');
  });

  it('ignora una respuesta tardía después de cambiar de proyecto', async () => {
    const original = task('task-1', 'Proyecto 1', 'column-1', 0);
    const otherProject = 'project-2';
    const otherBoard = { ...board, projectId: otherProject };
    const otherTask = { ...original, projectId: otherProject, title: 'Proyecto 2' };
    let resolveMove: (value: TaskResponse) => void = () => {};
    const taskMover = vi.fn().mockReturnValue(
      new Promise<TaskResponse>((resolve) => {
        resolveMove = resolve;
      }),
    );
    const boardFetcher = vi
      .fn()
      .mockImplementation((id: string) => Promise.resolve(id === projectId ? board : otherBoard));
    const tasksFetcher = vi
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve(id === projectId ? [original] : [otherTask]),
      );
    const { rerender } = render(
      <KanbanBoard
        projectId={projectId}
        boardFetcher={boardFetcher}
        tasksFetcher={tasksFetcher}
        taskMover={taskMover}
      />,
    );

    await waitFor(() => expect(screen.getByText('Proyecto 1')).toBeInTheDocument());
    await act(async () => {
      screen.getByTestId('trigger-move-to-progress').click();
    });
    rerender(
      <KanbanBoard
        projectId={otherProject}
        boardFetcher={boardFetcher}
        tasksFetcher={tasksFetcher}
        taskMover={taskMover}
      />,
    );
    await waitFor(() => expect(screen.getByText('Proyecto 2')).toBeInTheDocument());
    resolveMove({ ...original, title: 'Respuesta tardía', columnId: 'column-2' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(screen.getByText('Proyecto 2')).toBeInTheDocument();
    expect(screen.queryByText('Respuesta tardía')).not.toBeInTheDocument();
    expect(screen.queryByTestId('kanban-move-error')).not.toBeInTheDocument();
  });

  it('ignora un rechazo tardío después de cambiar de proyecto', async () => {
    const original = task('task-1', 'Proyecto 1', 'column-1', 0);
    const otherProject = 'project-2';
    const otherBoard = { ...board, projectId: otherProject };
    const otherTask = { ...original, projectId: otherProject, title: 'Proyecto 2' };
    let rejectMove: (error: Error) => void = () => {};
    const taskMover = vi.fn().mockReturnValue(
      new Promise<TaskResponse>((_, reject) => {
        rejectMove = reject;
      }),
    );
    const boardFetcher = vi
      .fn()
      .mockImplementation((id: string) => Promise.resolve(id === projectId ? board : otherBoard));
    const tasksFetcher = vi
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve(id === projectId ? [original] : [otherTask]),
      );
    const { rerender } = render(
      <KanbanBoard
        projectId={projectId}
        boardFetcher={boardFetcher}
        tasksFetcher={tasksFetcher}
        taskMover={taskMover}
      />,
    );

    await waitFor(() => expect(screen.getByText('Proyecto 1')).toBeInTheDocument());
    await act(async () => {
      screen.getByTestId('trigger-move-to-progress').click();
    });
    rerender(
      <KanbanBoard
        projectId={otherProject}
        boardFetcher={boardFetcher}
        tasksFetcher={tasksFetcher}
        taskMover={taskMover}
      />,
    );
    await waitFor(() => expect(screen.getByText('Proyecto 2')).toBeInTheDocument());
    await act(async () => {
      rejectMove(new Error('Rechazo tardío'));
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(screen.getByText('Proyecto 2')).toBeInTheDocument();
    expect(screen.queryByTestId('kanban-move-error')).not.toBeInTheDocument();
  });

  it('bloquea un segundo movimiento mientras el primero está pendiente', async () => {
    const original = task('task-1', 'Tarea original', 'column-1', 0);
    let resolveMove: (value: TaskResponse) => void = () => {};
    const taskMover = vi.fn().mockReturnValue(
      new Promise<TaskResponse>((resolve) => {
        resolveMove = resolve;
      }),
    );
    renderBoard([original], taskMover);

    await waitFor(() => expect(screen.getByText('Tarea original')).toBeInTheDocument());
    await act(async () => {
      screen.getByTestId('trigger-move-to-progress').click();
    });
    await waitFor(() => expect(screen.getByTestId('count-column-2')).toHaveTextContent('1'));
    await act(async () => {
      screen.getByTestId('trigger-move-to-progress').click();
    });
    expect(taskMover).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveMove({ ...original, columnId: 'column-2', orderIndex: 0 });
    });
  });
});
