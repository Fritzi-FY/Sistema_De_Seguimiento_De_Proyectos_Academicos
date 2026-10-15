/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddMemberModal } from './AddMemberModal.js';

describe('AddMemberModal Component', () => {
  const validUuid = '550e8400-e29b-41d4-a716-446655440000';

  it('no debe renderizar nada cuando isOpen es false', () => {
    const { container } = render(
      <AddMemberModal isOpen={false} isCreator={true} onClose={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('no debe renderizar nada cuando isCreator es false aunque isOpen sea true', () => {
    const { container } = render(
      <AddMemberModal isOpen={true} isCreator={false} onClose={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('debe renderizar el diálogo modal y sus campos cuando isOpen y isCreator son true', () => {
    render(<AddMemberModal isOpen={true} isCreator={true} onClose={vi.fn()} onSubmit={vi.fn()} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/Identificador del Usuario \(UUID\) \*/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Rol en el proyecto/i)).toBeInTheDocument();
    const roleSelect = screen.getByLabelText(/Rol en el proyecto/i) as HTMLSelectElement;
    expect(roleSelect.value).toBe('collaborator');
    expect(roleSelect).toBeDisabled();
  });

  it('debe validar reactivamente el formato UUID e impedir el envío si es inválido', () => {
    render(<AddMemberModal isOpen={true} isCreator={true} onClose={vi.fn()} onSubmit={vi.fn()} />);

    const input = screen.getByLabelText(/Identificador del Usuario \(UUID\) \*/i);
    const submitBtn = screen.getByRole('button', { name: /Agregar Integrante/i });

    // Inicialmente vacío: botón deshabilitado
    expect(submitBtn).toBeDisabled();

    // Valor no UUID
    fireEvent.change(input, { target: { value: 'usuario-invalido' } });
    expect(
      screen.getByText(/identificador de usuario debe ser un UUID válido/i),
    ).toBeInTheDocument();
    expect(submitBtn).toBeDisabled();

    // Valor UUID válido
    fireEvent.change(input, { target: { value: validUuid } });
    expect(
      screen.queryByText(/identificador de usuario debe ser un UUID válido/i),
    ).not.toBeInTheDocument();
    expect(submitBtn).not.toBeDisabled();
  });

  it('debe llamar a onSubmit con los datos validados al enviar el formulario', async () => {
    const onSubmitMock = vi.fn().mockResolvedValue(undefined);
    const onCloseMock = vi.fn();

    render(
      <AddMemberModal
        isOpen={true}
        isCreator={true}
        onClose={onCloseMock}
        onSubmit={onSubmitMock}
      />,
    );

    const input = screen.getByLabelText(/Identificador del Usuario \(UUID\) \*/i);
    fireEvent.change(input, { target: { value: validUuid } });

    const submitBtn = screen.getByRole('button', { name: /Agregar Integrante/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(onSubmitMock).toHaveBeenCalledWith({
        userId: validUuid,
        role: 'collaborator',
      });
    });

    expect(onCloseMock).toHaveBeenCalled();
  });

  it('debe mostrar mensaje accesible cuando ocurre un error de conflicto (409)', async () => {
    const onSubmitMock = vi
      .fn()
      .mockRejectedValue(new Error('El usuario ya es integrante activo del proyecto'));

    render(
      <AddMemberModal isOpen={true} isCreator={true} onClose={vi.fn()} onSubmit={onSubmitMock} />,
    );

    const input = screen.getByLabelText(/Identificador del Usuario \(UUID\) \*/i);
    fireEvent.change(input, { target: { value: validUuid } });

    const submitBtn = screen.getByRole('button', { name: /Agregar Integrante/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(
        screen.getByText('El usuario ya es integrante activo del proyecto'),
      ).toBeInTheDocument();
    });
  });

  it('debe bloquear el envío doble deshabilitando los controles durante la sumisión', async () => {
    let resolveSubmit: () => void = () => {};
    const onSubmitMock = vi.fn().mockReturnValue(
      new Promise<void>((res) => {
        resolveSubmit = res;
      }),
    );
    const onCloseMock = vi.fn();

    render(
      <AddMemberModal
        isOpen={true}
        isCreator={true}
        onClose={onCloseMock}
        onSubmit={onSubmitMock}
      />,
    );

    const input = screen.getByLabelText(/Identificador del Usuario \(UUID\) \*/i);
    fireEvent.change(input, { target: { value: validUuid } });

    const submitBtn = screen.getByRole('button', { name: /Agregar Integrante/i });
    fireEvent.click(submitBtn);

    expect(submitBtn).toBeDisabled();
    expect(input).toBeDisabled();

    resolveSubmit();
    await waitFor(() => {
      expect(onCloseMock).toHaveBeenCalled();
    });
    expect(input).not.toBeDisabled();
  });
});
