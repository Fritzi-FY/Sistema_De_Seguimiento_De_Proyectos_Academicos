/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { HealthResponse, ProjectResponse } from '@is488/shared';
import { AppShell } from './AppShell.js';

describe('AppShell Component (Frontend SPA Baseline)', () => {
  const dummyProject: ProjectResponse = {
    id: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    title: 'Proyecto de Prueba AppShell',
    description: 'Descripción de prueba',
    courseCode: 'IS-488',
    status: 'active',
    startDate: '2026-10-15T00:00:00.000Z',
    targetDate: '2026-12-15T23:59:59.000Z',
    creatorId: '11111111-1111-4111-8111-111111111111',
    createdAt: '2026-10-11T12:00:00.000Z',
    updatedAt: '2026-10-11T12:00:00.000Z',
  };

  const defaultMockProjectsFetcher = vi.fn().mockResolvedValue([dummyProject]);
  const defaultMockProjectCreator = vi.fn().mockResolvedValue(dummyProject);

  it('debe mostrar el estado de carga inicialmente mientras se consulta el backend', () => {
    // Retrasar resolución para observar el estado de carga
    const pendingPromise = new Promise<HealthResponse>(() => {});
    const pendingProjects = new Promise<ProjectResponse[]>(() => {});
    const mockFetcher = vi.fn().mockReturnValue(pendingPromise);
    const mockProjects = vi.fn().mockReturnValue(pendingProjects);

    render(
      <AppShell
        healthFetcher={mockFetcher}
        projectsFetcher={mockProjects}
        projectCreator={defaultMockProjectCreator}
      />,
    );

    const statusElements = screen.getAllByRole('status');
    expect(statusElements.length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Consultando disponibilidad operativa en el backend/i),
    ).toBeInTheDocument();
  });

  it('debe renderizar el estado de éxito con datos de versión y timestamp cuando el backend responde correctamente', async () => {
    const mockData: HealthResponse = {
      status: 'ok',
      timestamp: '2026-10-10T12:00:00.000Z',
      version: '0.1.0',
    };
    const mockFetcher = vi.fn().mockResolvedValue(mockData);

    render(
      <AppShell
        healthFetcher={mockFetcher}
        projectsFetcher={defaultMockProjectsFetcher}
        projectCreator={defaultMockProjectCreator}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Backend conectado y operativo/i)).toBeInTheDocument();
    });

    expect(screen.getByText('0.1.0')).toBeInTheDocument();
    expect(screen.getByText('2026-10-10T12:00:00.000Z')).toBeInTheDocument();
    expect(screen.getByText('OK')).toBeInTheDocument();
  });

  it('debe renderizar el estado de error y botón de reintento cuando falla la consulta al backend', async () => {
    const errorMessage = 'Fallo de red: 503 Service Unavailable';
    const mockFetcher = vi.fn().mockRejectedValue(new Error(errorMessage));

    render(
      <AppShell
        healthFetcher={mockFetcher}
        projectsFetcher={defaultMockProjectsFetcher}
        projectCreator={defaultMockProjectCreator}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText(/No fue posible conectar con el backend/i)).toBeInTheDocument();
    expect(screen.getByText(errorMessage)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reintentar conexión/i })).toBeInTheDocument();
  });

  it('debe permitir reintentar la comprobación al presionar el botón de reintento', async () => {
    const mockFetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('Fallo transitorio'))
      .mockResolvedValueOnce({
        status: 'ok',
        timestamp: '2026-10-10T12:05:00.000Z',
        version: '0.1.0',
      });

    render(
      <AppShell
        healthFetcher={mockFetcher}
        projectsFetcher={defaultMockProjectsFetcher}
        projectCreator={defaultMockProjectCreator}
      />,
    );

    // Esperar al fallo inicial
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    // Hacer clic en reintentar
    const retryBtn = screen.getByRole('button', { name: /Reintentar conexión/i });
    fireEvent.click(retryBtn);

    // Debe mostrar éxito tras el segundo intento
    await waitFor(() => {
      expect(screen.getByText(/Backend conectado y operativo/i)).toBeInTheDocument();
    });

    expect(mockFetcher).toHaveBeenCalledTimes(2);
  });

  it('debe renderizar la sección de proyectos e interactuar con el modal de creación', async () => {
    const mockHealth: HealthResponse = {
      status: 'ok',
      timestamp: '2026-10-10T12:00:00.000Z',
      version: '0.1.0',
    };
    const mockFetcher = vi.fn().mockResolvedValue(mockHealth);

    render(
      <AppShell
        healthFetcher={mockFetcher}
        projectsFetcher={defaultMockProjectsFetcher}
        projectCreator={defaultMockProjectCreator}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Proyecto de Prueba AppShell')).toBeInTheDocument();
    });

    // Abrir modal de creación
    const createBtn = screen.getByRole('button', { name: /Nuevo Proyecto/i });
    fireEvent.click(createBtn);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('debe navegar hacia la vista de detalle de un proyecto y regresar a la lista de proyectos', async () => {
    const mockHealth: HealthResponse = {
      status: 'ok',
      timestamp: '2026-10-10T12:00:00.000Z',
      version: '0.1.0',
    };
    const mockFetcher = vi.fn().mockResolvedValue(mockHealth);

    render(
      <AppShell
        healthFetcher={mockFetcher}
        projectsFetcher={defaultMockProjectsFetcher}
        projectCreator={defaultMockProjectCreator}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Proyecto de Prueba AppShell')).toBeInTheDocument();
    });

    const viewDetailBtn = screen.getByTestId(`view-project-btn-${dummyProject.id}`);
    fireEvent.click(viewDetailBtn);

    // Debe mostrar la vista de detalle
    expect(screen.getByTestId('project-detail-view')).toBeInTheDocument();

    // Regresar a la lista
    const backBtn = screen.getByTestId('back-to-list-btn');
    fireEvent.click(backBtn);

    // Debe volver a la lista
    expect(screen.queryByTestId('project-detail-view')).not.toBeInTheDocument();
    expect(screen.getByText('Proyecto de Prueba AppShell')).toBeInTheDocument();
  });
});
