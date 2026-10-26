/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TaskResponse } from '@is488/shared';
import { EditTaskModal } from './EditTaskModal.js';

const task: TaskResponse = {
  id: '33333333-3333-4333-8333-333333333333',
  projectId: '11111111-1111-4111-8111-111111111111',
  columnId: '22222222-2222-4222-8222-222222222222',
  title: 'Tarea original',
  description: 'Descripción original',
  priority: 'MEDIUM',
  orderIndex: 0,
  dueDate: '2026-10-21T00:00:00.000Z',
  labels: ['frontend'],
  creatorId: 'dev-student-01',
  assigneeIds: ['44444444-4444-4444-8444-444444444444'],
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
};

describe('EditTaskModal', () => {
  it('deshabilita guardar sin cambios y envía solo campos modificados, sin asignados', async () => {
    const onSubmit = vi.fn().mockResolvedValue(task);
    render(<EditTaskModal isOpen task={task} onClose={vi.fn()} onSubmit={onSubmit} />);

    const save = screen.getByRole('button', { name: 'Guardar cambios' });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Descripción'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Fecha límite'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Etiquetas'), { target: { value: '' } });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({ description: '', dueDate: null, labels: [] }),
    );
  });

  it('conserva los cambios e informa cuando la actualización falla', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Fallo de red'));
    render(<EditTaskModal isOpen task={task} onClose={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Título cambiado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Fallo de red'));
    expect(screen.getByLabelText('Título *')).toHaveValue('Título cambiado');
  });
});
