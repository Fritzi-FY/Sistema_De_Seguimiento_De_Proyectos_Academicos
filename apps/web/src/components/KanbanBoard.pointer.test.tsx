import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardResponse, TaskResponse } from '@is488/shared';
import { KanbanBoard } from './KanbanBoard.js';

const stamp = '2026-10-25T00:00:00.000Z';
const board: BoardResponse = {
  id: 'board',
  projectId: 'project',
  createdAt: stamp,
  updatedAt: stamp,
  columns: ['todo', 'progress', 'done'].map((id, orderIndex) => ({
    id,
    boardId: 'board',
    name: id,
    orderIndex,
    category: 'TODO',
    createdAt: stamp,
    updatedAt: stamp,
  })),
};
const tasks: TaskResponse[] = Array.from({ length: 21 }, (_, index) => ({
  id: `task-${index + 1}`,
  projectId: 'project',
  columnId: 'todo',
  title: `Tarea ${index + 1}`,
  orderIndex: index,
  priority: 'MEDIUM',
  labels: [],
  assigneeIds: [],
  creatorId: 'user',
  createdAt: stamp,
  updatedAt: stamp,
}));

function mockLayout() {
  class TestPointerEvent extends MouseEvent {
    isPrimary = true;
    pointerId = 1;
    pointerType = 'mouse';
  }
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const column = this.closest('section[data-testid^="kanban-column-"]');
    const columnId = column?.getAttribute('data-testid')?.replace('kanban-column-', '');
    const x = columnId === 'progress' ? 340 : columnId === 'done' ? 680 : 0;
    const card = this.getAttribute('data-testid')?.match(/^task-card-task-(\d+)$/);
    if (card) return new DOMRect(x + 16, 100 + (Number(card[1]) - 1) * 220, 288, 200);
    if (this === column) return new DOMRect(x, 0, 320, 5000);
    if (this.tagName === 'UL' && column) return new DOMRect(x + 16, 100, 288, 4880);
    if (this.getAttribute('data-testid')?.startsWith('empty-column-'))
      return new DOMRect(x + 16, 100, 288, 128);
    return new DOMRect(x, 0, 320, 600);
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PointerSensor against long and empty column geometry (no DnD mocks)', () => {
  it.each([
    ['progress', 490, 180],
    ['done', 830, 180],
    ['progress', 490, 600],
    ['done', 830, 600],
    ['progress', 350, 20],
    ['done', 690, 20],
  ] as const)('moves to %s at (%i, %i) through the real pointer sensor', async (column, x, y) => {
    mockLayout();
    const taskMover = vi.fn().mockResolvedValue({ ...tasks[0]!, columnId: column, orderIndex: 0 });
    render(
      <KanbanBoard
        projectId="project"
        boardFetcher={async () => board}
        tasksFetcher={async () => tasks}
        taskMover={taskMover}
      />,
    );
    const handle = await screen.findByRole('button', { name: 'Arrastrar tarea Tarea 1' });
    fireEvent.pointerDown(handle, { button: 0, clientX: 160, clientY: 250 });
    fireEvent.pointerMove(document, { clientX: 180, clientY: 250 });
    await act(async () => {});
    fireEvent.pointerMove(document, { clientX: x, clientY: y });
    await act(async () => {});
    fireEvent.pointerUp(document, { clientX: x, clientY: y });
    await waitFor(() =>
      expect(taskMover).toHaveBeenCalledWith('project', 'task-1', {
        destinationColumnId: column,
        destinationIndex: 0,
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId(`column-task-count-${column}`)).toHaveTextContent('1'),
    );
    expect(screen.getByTestId('column-task-count-todo')).toHaveTextContent('20');
    expect(screen.getAllByTestId('task-card-task-1')).toHaveLength(1);
  });
});
