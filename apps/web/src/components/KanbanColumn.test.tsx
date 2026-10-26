/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { BoardColumnResponse, TaskResponse } from '@is488/shared';
import { KanbanColumn } from './KanbanColumn.js';

describe('KanbanColumn Component', () => {
  const sampleColumn: BoardColumnResponse = {
    id: '11111111-1111-4111-8111-111111111111',
    boardId: '22222222-2222-4222-8222-222222222222',
    name: 'Revisión Técnica',
    orderIndex: 2,
    category: 'IN_REVIEW',
    color: '#d97706',
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
  };

  const makeTask = (id: string, orderIndex: number, title: string): TaskResponse => ({
    id,
    projectId: '33333333-3333-4333-8333-333333333333',
    columnId: sampleColumn.id,
    title,
    priority: 'MEDIUM',
    orderIndex,
    labels: [],
    creatorId: 'dev-student-01',
    assigneeIds: [],
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
  });

  it('debe renderizar el título de la columna, el contador y ordenar las tareas por orderIndex', () => {
    // Tareas enviadas intencionalmente desordenadas
    const tasks: TaskResponse[] = [
      makeTask('task-c', 2, 'Tercera tarea'),
      makeTask('task-a', 0, 'Primera tarea'),
      makeTask('task-b', 1, 'Segunda tarea'),
    ];

    render(<KanbanColumn column={sampleColumn} tasks={tasks} />);

    expect(screen.getByRole('heading', { level: 3, name: 'Revisión Técnica' })).toBeInTheDocument();
    expect(screen.getByTestId(`column-task-count-${sampleColumn.id}`)).toHaveTextContent('3');

    // Verificar orden contiguo de renderizado en la lista
    const list = screen.getByRole('list', { name: `Tareas en columna ${sampleColumn.name}` });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);

    expect(within(items[0]!).getByText('Primera tarea')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Segunda tarea')).toBeInTheDocument();
    expect(within(items[2]!).getByText('Tercera tarea')).toBeInTheDocument();
  });

  it('debe mostrar estado de columna vacía cuando no contiene tareas', () => {
    render(<KanbanColumn column={sampleColumn} tasks={[]} />);

    expect(screen.getByTestId(`column-task-count-${sampleColumn.id}`)).toHaveTextContent('0');
    expect(screen.getByTestId(`empty-column-${sampleColumn.id}`)).toHaveTextContent(
      'Sin tareas en esta columna',
    );
  });

  it('propaga la apertura de edición hasta la tarjeta', () => {
    const task = makeTask('task-edit', 0, 'Editar esta tarea');
    const onEditTask = vi.fn();
    render(<KanbanColumn column={sampleColumn} tasks={[task]} onEditTask={onEditTask} />);

    fireEvent.click(screen.getByRole('button', { name: 'Editar tarea' }));
    expect(onEditTask).toHaveBeenCalledWith(task, expect.any(HTMLButtonElement));
  });

  it('bloquea agregar y editar mientras un movimiento está pendiente', () => {
    const task = makeTask('task-locked', 0, 'Tarea bloqueada');
    render(
      <KanbanColumn
        column={sampleColumn}
        tasks={[task]}
        onAddTask={vi.fn()}
        onEditTask={vi.fn()}
        isInteractionLocked
      />,
    );

    expect(screen.getByRole('button', { name: 'Agregar tarea' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Editar tarea' })).toBeDisabled();
    expect(screen.getByRole('button', { name: `Arrastrar tarea ${task.title}` })).toBeDisabled();
  });
});
