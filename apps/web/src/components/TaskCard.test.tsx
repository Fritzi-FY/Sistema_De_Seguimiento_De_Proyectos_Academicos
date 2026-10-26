/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { TaskResponse } from '@is488/shared';
import { TaskCard } from './TaskCard.js';

describe('TaskCard Component', () => {
  const sampleTask: TaskResponse = {
    id: '11111111-1111-4111-8111-111111111111',
    projectId: '22222222-2222-4222-8222-222222222222',
    columnId: '33333333-3333-4333-8333-333333333333',
    title: 'Diseñar arquitectura hexagonal',
    description: 'Separar dominio, puertos y adaptadores HTTP',
    priority: 'HIGH',
    orderIndex: 0,
    dueDate: '2026-11-01T12:00:00.000Z',
    labels: ['backend', 'arquitectura'],
    creatorId: 'dev-student-01',
    assigneeIds: ['44444444-4444-4444-8444-444444444444', '55555555-5555-5555-8555-555555555555'],
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
  };

  it('debe renderizar título, descripción, etiquetas y metadatos accesibles', () => {
    render(<TaskCard task={sampleTask} />);

    expect(
      screen.getByRole('heading', { level: 4, name: 'Diseñar arquitectura hexagonal' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Separar dominio, puertos y adaptadores HTTP')).toBeInTheDocument();
    expect(screen.getByText('Alta')).toBeInTheDocument();
    expect(screen.getByText('backend')).toBeInTheDocument();
    expect(screen.getByText('arquitectura')).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // 2 assignees
  });

  it('no debe asignar tabIndex ni simular roles de botón en modo solo lectura', () => {
    render(<TaskCard task={sampleTask} />);

    const article = screen.getByTestId(`task-card-${sampleTask.id}`);
    expect(article).toBeInTheDocument();
    expect(article).not.toHaveAttribute('tabIndex');
    expect(article).not.toHaveAttribute('role', 'button');
  });

  it('debe renderizar adecuadamente tareas con prioridad URGENT y sin descripción ni etiquetas opcionales', () => {
    const minimalTask: TaskResponse = {
      ...sampleTask,
      id: '99999999-9999-4999-8999-999999999999',
      title: 'Incidencia crítica en producción',
      description: undefined,
      priority: 'URGENT',
      labels: [],
      assigneeIds: [],
      dueDate: undefined,
    };

    render(<TaskCard task={minimalTask} />);

    expect(
      screen.getByRole('heading', { level: 4, name: 'Incidencia crítica en producción' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Urgente')).toBeInTheDocument();
    expect(screen.queryByLabelText('Etiquetas')).not.toBeInTheDocument();
  });

  it('separa el control de arrastre del botón Editar tarea', () => {
    const onEdit = vi.fn();
    render(<TaskCard task={sampleTask} onEdit={onEdit} isDraggable />);

    const dragHandle = screen.getByRole('button', {
      name: `Arrastrar tarea ${sampleTask.title}`,
    });
    expect(dragHandle).toHaveAttribute('aria-roledescription', 'sortable');
    fireEvent.click(dragHandle);
    expect(onEdit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Editar tarea' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('deshabilita el control de arrastre y edición durante una mutación pendiente', () => {
    render(<TaskCard task={sampleTask} onEdit={vi.fn()} isDraggable isInteractionLocked />);

    expect(
      screen.getByRole('button', { name: `Arrastrar tarea ${sampleTask.title}` }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Editar tarea' })).toBeDisabled();
  });
});
