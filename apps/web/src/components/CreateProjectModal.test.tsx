/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateProjectModal } from './CreateProjectModal.js';

describe('CreateProjectModal Component', () => {
  it('no debe renderizar nada cuando isOpen es false', () => {
    const { container } = render(
      <CreateProjectModal isOpen={false} onClose={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('debe renderizar el diálogo modal y sus campos cuando isOpen es true', () => {
    render(<CreateProjectModal isOpen={true} onClose={vi.fn()} onSubmit={vi.fn()} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/Título del proyecto \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Código de curso \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Fecha de inicio \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Fecha de entrega estimada \*/i)).toBeInTheDocument();
  });

  it('debe invocar onClose al hacer clic en el botón Cancelar o Cerrar', () => {
    const onCloseMock = vi.fn();
    render(<CreateProjectModal isOpen={true} onClose={onCloseMock} onSubmit={vi.fn()} />);

    const cancelBtn = screen.getByRole('button', { name: /Cancelar/i });
    fireEvent.click(cancelBtn);
    expect(onCloseMock).toHaveBeenCalledTimes(1);

    const closeBtn = screen.getByRole('button', { name: /Cerrar modal/i });
    fireEvent.click(closeBtn);
    expect(onCloseMock).toHaveBeenCalledTimes(2);
  });

  it('debe advertir y deshabilitar el botón de envío si la fecha de entrega es anterior a la fecha de inicio', () => {
    render(<CreateProjectModal isOpen={true} onClose={vi.fn()} onSubmit={vi.fn()} />);

    const startDateInput = screen.getByLabelText(/Fecha de inicio \*/i);
    const targetDateInput = screen.getByLabelText(/Fecha de entrega estimada \*/i);

    fireEvent.change(startDateInput, { target: { value: '2026-12-01' } });
    fireEvent.change(targetDateInput, { target: { value: '2026-11-01' } });

    expect(
      screen.getByText(/La fecha de entrega debe ser igual o posterior a la fecha de inicio/i),
    ).toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: /Guardar Proyecto/i });
    expect(submitBtn).toBeDisabled();
  });

  it('debe llamar a onSubmit con los datos formateados al completar un formulario válido', async () => {
    const onSubmitMock = vi.fn().mockResolvedValue(undefined);
    const onCloseMock = vi.fn();

    render(<CreateProjectModal isOpen={true} onClose={onCloseMock} onSubmit={onSubmitMock} />);

    const titleInput = screen.getByLabelText(/Título del proyecto \*/i);
    const courseInput = screen.getByLabelText(/Código de curso \*/i);
    const startDateInput = screen.getByLabelText(/Fecha de inicio \*/i);
    const targetDateInput = screen.getByLabelText(/Fecha de entrega estimada \*/i);

    fireEvent.change(titleInput, { target: { value: 'Proyecto Nuevo de Ingeniería' } });
    fireEvent.change(courseInput, { target: { value: 'IS-488' } });
    fireEvent.change(startDateInput, { target: { value: '2026-10-15' } });
    fireEvent.change(targetDateInput, { target: { value: '2026-12-15' } });

    const submitBtn = screen.getByRole('button', { name: /Guardar Proyecto/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSubmitMock).toHaveBeenCalledWith({
        title: 'Proyecto Nuevo de Ingeniería',
        description: undefined,
        courseCode: 'IS-488',
        startDate: '2026-10-15T00:00:00.000Z',
        targetDate: '2026-12-15T23:59:59.000Z',
      });
    });

    expect(onCloseMock).toHaveBeenCalled();
  });
});
