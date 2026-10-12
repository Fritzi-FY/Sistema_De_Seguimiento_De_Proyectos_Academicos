/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ProjectResponse } from '@is488/shared';
import { ProjectList } from './ProjectList.js';

describe('ProjectList Component', () => {
  const sampleProject: ProjectResponse = {
    id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    title: 'Proyecto de Tesis IS488',
    description: 'Investigación sobre arquitecturas de software',
    courseCode: 'IS-488',
    status: 'active',
    startDate: '2026-10-15T00:00:00.000Z',
    targetDate: '2026-12-15T23:59:59.000Z',
    creatorId: 'dev-student-01',
    createdAt: '2026-10-11T12:00:00.000Z',
    updatedAt: '2026-10-11T12:00:00.000Z',
  };

  it('debe mostrar el estado de carga con indicador accesible cuando loading es true', () => {
    render(
      <ProjectList
        projects={[]}
        loading={true}
        error={null}
        onRetry={vi.fn()}
        onOpenCreateModal={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/Cargando proyectos académicos/i)).toBeInTheDocument();
  });

  it('debe renderizar el mensaje de error y botón de reintento cuando error está presente', () => {
    const onRetryMock = vi.fn();
    render(
      <ProjectList
        projects={[]}
        loading={false}
        error="Error 500 al conectar con el backend"
        onRetry={onRetryMock}
        onOpenCreateModal={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Error 500 al conectar con el backend')).toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: /Reintentar consulta/i });
    fireEvent.click(retryButton);
    expect(onRetryMock).toHaveBeenCalledTimes(1);
  });

  it('debe mostrar el estado vacío amigable cuando la lista de proyectos está vacía', () => {
    const onOpenMock = vi.fn();
    render(
      <ProjectList
        projects={[]}
        loading={false}
        error={null}
        onRetry={vi.fn()}
        onOpenCreateModal={onOpenMock}
      />,
    );

    expect(screen.getByTestId('empty-projects-state')).toBeInTheDocument();
    expect(screen.getByText(/No hay proyectos registrados/i)).toBeInTheDocument();

    const createBtn = screen.getByRole('button', { name: /Crear Proyecto/i });
    fireEvent.click(createBtn);
    expect(onOpenMock).toHaveBeenCalledTimes(1);
  });

  it('debe renderizar las tarjetas de proyecto con título, curso y metadatos cuando hay proyectos', () => {
    render(
      <ProjectList
        projects={[sampleProject]}
        loading={false}
        error={null}
        onRetry={vi.fn()}
        onOpenCreateModal={vi.fn()}
      />,
    );

    expect(screen.getByText('Proyecto de Tesis IS488')).toBeInTheDocument();
    expect(screen.getByText('IS-488')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByText('dev-student-01')).toBeInTheDocument();
    expect(screen.getByText('Investigación sobre arquitecturas de software')).toBeInTheDocument();
    expect(screen.getByText('15/10/2026')).toBeInTheDocument();
    expect(screen.getByText('15/12/2026')).toBeInTheDocument();
  });
});
