/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { MembershipResponse } from '@is488/shared';
import { ProjectMembersList } from './ProjectMembersList.js';

describe('ProjectMembersList Component', () => {
  const sampleMembers: MembershipResponse[] = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      projectId: '99999999-9999-4999-8999-999999999999',
      userId: 'dev-student-01',
      role: 'owner',
      status: 'active',
      joinedAt: '2026-10-15T10:00:00.000Z',
      updatedAt: '2026-10-15T10:00:00.000Z',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      projectId: '99999999-9999-4999-8999-999999999999',
      userId: 'dev-student-02',
      role: 'collaborator',
      status: 'active',
      joinedAt: '2026-10-16T14:30:00.000Z',
      updatedAt: '2026-10-16T14:30:00.000Z',
    },
  ];

  it('debe mostrar el estado de carga skeleton cuando loading es true', () => {
    render(<ProjectMembersList members={[]} loading={true} error={null} isCreator={true} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/Cargando integrantes/i)).toBeInTheDocument();
    expect(screen.getByTestId('members-loading-skeleton')).toBeInTheDocument();
  });

  it('debe mostrar mensaje de error cuando ocurre un fallo al cargar', () => {
    const onRetryMock = vi.fn();
    render(
      <ProjectMembersList
        members={[]}
        loading={false}
        error="Fallo al obtener integrantes"
        isCreator={true}
        onRetry={onRetryMock}
      />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Fallo al obtener integrantes/i)).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /Reintentar/i });
    fireEvent.click(retryBtn);
    expect(onRetryMock).toHaveBeenCalledTimes(1);
  });

  it('debe mostrar el estado vacío amigable cuando la lista de miembros está vacía', () => {
    render(<ProjectMembersList members={[]} loading={false} error={null} isCreator={true} />);

    expect(screen.getByTestId('empty-members-state')).toBeInTheDocument();
    expect(screen.getByText(/No hay integrantes registrados/i)).toBeInTheDocument();
  });

  it('debe renderizar la lista de miembros con sus roles y fechas', () => {
    render(
      <ProjectMembersList members={sampleMembers} loading={false} error={null} isCreator={false} />,
    );

    expect(screen.getByTestId('members-list')).toBeInTheDocument();
    expect(screen.getByText('dev-student-01')).toBeInTheDocument();
    expect(screen.getByText('Propietario')).toBeInTheDocument();
    expect(screen.getByText('dev-student-02')).toBeInTheDocument();
    expect(screen.getByText('Colaborador')).toBeInTheDocument();
  });

  it('no debe mostrar botón de retirar si el usuario no es creador', () => {
    render(
      <ProjectMembersList
        members={sampleMembers}
        loading={false}
        error={null}
        isCreator={false}
        onRemoveMember={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('remove-member-btn-dev-student-02')).not.toBeInTheDocument();
    expect(screen.queryByTestId('remove-member-btn-dev-student-01')).not.toBeInTheDocument();
  });

  it('debe mostrar botón de retirar solo para colaboradores cuando isCreator es true', () => {
    const onRemoveMock = vi.fn();
    render(
      <ProjectMembersList
        members={sampleMembers}
        loading={false}
        error={null}
        isCreator={true}
        onRemoveMember={onRemoveMock}
      />,
    );

    // No debe existir botón para el owner
    expect(screen.queryByTestId('remove-member-btn-dev-student-01')).not.toBeInTheDocument();

    // Debe existir para el colaborador
    const removeBtn = screen.getByTestId('remove-member-btn-dev-student-02');
    expect(removeBtn).toBeInTheDocument();

    fireEvent.click(removeBtn);
    expect(onRemoveMock).toHaveBeenCalledWith('dev-student-02');
  });
});
