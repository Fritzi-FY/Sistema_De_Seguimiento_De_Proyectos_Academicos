/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { BoardColumnResponse, TaskResponse } from '@is488/shared';
import { CreateTaskModal } from './CreateTaskModal.js';

describe('CreateTaskModal', () => {
  const column: BoardColumnResponse = {
    id: '11111111-1111-4111-8111-111111111111',
    boardId: '22222222-2222-4222-8222-222222222222',
    name: 'Por hacer',
    orderIndex: 0,
    category: 'TODO',
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
  };

  const task = {
    id: '33333333-3333-4333-8333-333333333333',
    projectId: '44444444-4444-4444-8444-444444444444',
    columnId: column.id,
    title: 'Tarea creada',
    priority: 'MEDIUM',
    orderIndex: 0,
    labels: [],
    creatorId: 'dev-student-01',
    assigneeIds: [],
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
  } satisfies TaskResponse;

  it('enfoca el título, permite Escape y restaura el foco al botón de apertura', () => {
    const onClose = vi.fn();
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(
      <CreateTaskModal
        isOpen
        columns={[column]}
        onClose={onClose}
        onSubmit={vi.fn().mockResolvedValue(task)}
        returnFocusRef={{ current: opener }}
      />,
    );

    expect(document.activeElement).toBe(screen.getByLabelText('Título *'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <CreateTaskModal
        isOpen={false}
        columns={[column]}
        onClose={onClose}
        onSubmit={vi.fn().mockResolvedValue(task)}
        returnFocusRef={{ current: opener }}
      />,
    );
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('mantiene Tab dentro del modal', () => {
    render(
      <CreateTaskModal
        isOpen
        columns={[column]}
        onClose={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(task)}
      />,
    );
    const submit = screen.getByRole('button', { name: 'Crear tarea' });
    submit.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Cerrar modal de nueva tarea' }),
    );

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(submit);
  });
});
