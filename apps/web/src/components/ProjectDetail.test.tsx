/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ProjectResponse, MembershipResponse } from '@is488/shared';
import { ProjectDetail } from './ProjectDetail.js';

describe('ProjectDetail Component', () => {
  const sampleProject: ProjectResponse = {
    id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    title: 'Proyecto de Tesis IS488',
    description: 'Investigación sobre arquitecturas de software',
    courseCode: 'IS-488',
    status: 'active',
    startDate: '2026-10-15T00:00:00.000Z',
    targetDate: '2026-12-15T23:59:59.000Z',
    creatorId: '11111111-1111-4111-8111-111111111111',
    createdAt: '2026-10-11T12:00:00.000Z',
    updatedAt: '2026-10-11T12:00:00.000Z',
  };

  const sampleMembers: MembershipResponse[] = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      projectId: sampleProject.id,
      userId: '11111111-1111-4111-8111-111111111111',
      role: 'owner',
      status: 'active',
      removedAt: null,
      joinedAt: '2026-10-15T10:00:00.000Z',
      updatedAt: '2026-10-15T10:00:00.000Z',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      projectId: sampleProject.id,
      userId: '22222222-2222-4222-8222-222222222222',
      role: 'collaborator',
      status: 'active',
      removedAt: null,
      joinedAt: '2026-10-16T14:30:00.000Z',
      updatedAt: '2026-10-16T14:30:00.000Z',
    },
  ];

  it('debe renderizar los datos del proyecto y la lista de integrantes', async () => {
    const onBackMock = vi.fn();
    const membersFetcherMock = vi.fn().mockResolvedValue(sampleMembers);

    render(
      <ProjectDetail
        project={sampleProject}
        currentUserId="11111111-1111-4111-8111-111111111111"
        onBack={onBackMock}
        membersFetcher={membersFetcherMock}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 2, name: 'Proyecto de Tesis IS488' }),
    ).toBeInTheDocument();
    expect(screen.getByText('IS-488')).toBeInTheDocument();
    expect(screen.getByText('Investigación sobre arquitecturas de software')).toBeInTheDocument();
    expect(screen.getByText('Eres el Propietario')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Integrantes del Proyecto (2)')).toBeInTheDocument();
      expect(
        screen.getByTestId('member-row-11111111-1111-4111-8111-111111111111'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('member-row-22222222-2222-4222-8222-222222222222'),
      ).toBeInTheDocument();
    });

    const backBtn = screen.getByTestId('back-to-list-btn');
    fireEvent.click(backBtn);
    expect(onBackMock).toHaveBeenCalledTimes(1);
  });

  it('debe permitir al creador abrir el modal de agregar integrante y agregar un miembro', async () => {
    const membersFetcherMock = vi.fn().mockResolvedValue(sampleMembers);
    const newMember: MembershipResponse = {
      id: '33333333-3333-4333-8333-333333333333',
      projectId: sampleProject.id,
      userId: '550e8400-e29b-41d4-a716-446655440000',
      role: 'collaborator',
      status: 'active',
      removedAt: null,
      joinedAt: '2026-10-17T10:00:00.000Z',
      updatedAt: '2026-10-17T10:00:00.000Z',
    };
    const memberAdderMock = vi.fn().mockResolvedValue(newMember);

    render(
      <ProjectDetail
        project={sampleProject}
        currentUserId="11111111-1111-4111-8111-111111111111"
        onBack={vi.fn()}
        membersFetcher={membersFetcherMock}
        memberAdder={memberAdderMock}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('open-add-member-modal-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('open-add-member-modal-btn'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    const input = screen.getByLabelText(/Identificador del Usuario \(UUID\) \*/i);
    fireEvent.change(input, { target: { value: '550e8400-e29b-41d4-a716-446655440000' } });

    const submitBtn = within(dialog).getByRole('button', { name: /Agregar Integrante/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(memberAdderMock).toHaveBeenCalledWith(sampleProject.id, {
        userId: '550e8400-e29b-41d4-a716-446655440000',
        role: 'collaborator',
      });
      expect(
        screen.getByTestId('member-row-550e8400-e29b-41d4-a716-446655440000'),
      ).toBeInTheDocument();
    });
  });

  it('no debe mostrar botón de agregar integrante a un colaborador que no es el creador', async () => {
    const membersFetcherMock = vi.fn().mockResolvedValue(sampleMembers);

    render(
      <ProjectDetail
        project={sampleProject}
        currentUserId="22222222-2222-4222-8222-222222222222"
        onBack={vi.fn()}
        membersFetcher={membersFetcherMock}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('open-add-member-modal-btn')).not.toBeInTheDocument();
      expect(screen.getByText(/Solo el creador puede gestionar integrantes/i)).toBeInTheDocument();
    });
  });

  it('debe permitir al creador retirar a un colaborador', async () => {
    const membersFetcherMock = vi.fn().mockResolvedValue(sampleMembers);
    const memberRemoverMock = vi.fn().mockResolvedValue({
      ...sampleMembers[1],
      status: 'removed',
      removedAt: sampleMembers[1]!.updatedAt,
    });

    render(
      <ProjectDetail
        project={sampleProject}
        currentUserId="11111111-1111-4111-8111-111111111111"
        onBack={vi.fn()}
        membersFetcher={membersFetcherMock}
        memberRemover={memberRemoverMock}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('remove-member-btn-22222222-2222-4222-8222-222222222222'),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('remove-member-btn-22222222-2222-4222-8222-222222222222'));

    await waitFor(() => {
      expect(memberRemoverMock).toHaveBeenCalledWith(
        sampleProject.id,
        '22222222-2222-4222-8222-222222222222',
        sampleMembers[1]!.id,
      );
      expect(screen.queryByText('22222222-2222-4222-8222-222222222222')).not.toBeInTheDocument();
    });
  });

  it('debe integrar y renderizar la sección de Tablero Kanban con columnas y tarjetas', async () => {
    const boardFetcherMock = vi.fn().mockResolvedValue({
      id: '22222222-2222-4222-8222-222222222222',
      projectId: sampleProject.id,
      columns: [
        {
          id: 'col-1',
          boardId: '22222222-2222-4222-8222-222222222222',
          name: 'Por Hacer',
          orderIndex: 0,
          category: 'TODO',
          createdAt: '2026-10-20T10:00:00.000Z',
          updatedAt: '2026-10-20T10:00:00.000Z',
        },
      ],
      createdAt: '2026-10-20T10:00:00.000Z',
      updatedAt: '2026-10-20T10:00:00.000Z',
    });

    const tasksFetcherMock = vi.fn().mockResolvedValue([
      {
        id: 't-1',
        projectId: sampleProject.id,
        columnId: 'col-1',
        title: 'Primera Tarea de Prueba',
        priority: 'MEDIUM',
        orderIndex: 0,
        labels: [],
        creatorId: '11111111-1111-4111-8111-111111111111',
        assigneeIds: [],
        createdAt: '2026-10-20T10:00:00.000Z',
        updatedAt: '2026-10-20T10:00:00.000Z',
      },
    ]);

    render(
      <ProjectDetail
        project={sampleProject}
        onBack={vi.fn()}
        membersFetcher={vi.fn().mockResolvedValue(sampleMembers)}
        boardFetcher={boardFetcherMock}
        tasksFetcher={tasksFetcherMock}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 3, name: 'Tablero de Tareas Kanban' }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('kanban-board')).toBeInTheDocument();
      expect(screen.getByText('Por Hacer')).toBeInTheDocument();
      expect(screen.getByText('Primera Tarea de Prueba')).toBeInTheDocument();
    });
  });
});
