import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProjectDetail } from './ProjectDetail.js';
import type { ProjectResponse, BoardResponse, ProjectAICapabilitiesResponse } from '@is488/shared';

const mockProject: ProjectResponse = {
  id: 'proj-001',
  title: 'Proyecto Integrador IS488',
  description: 'Descripción de prueba del proyecto',
  courseCode: 'IS-488',
  status: 'active',
  creatorId: 'usr-prof-01',
  startDate: '2026-03-01T00:00:00.000Z',
  targetDate: '2026-07-15T00:00:00.000Z',
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
};

const mockBoard: BoardResponse = {
  id: 'board-001',
  projectId: 'proj-001',
  columns: [],
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
};

describe('ProjectDetail - Integración del Asistente IA', () => {
  it('renderiza el botón "Asistente IA" en la cabecera sin ejecutar llamadas automáticas al montar', async () => {
    const aiSummaryFetcher = vi.fn();
    const onBack = vi.fn();

    render(
      <ProjectDetail
        project={mockProject}
        onBack={onBack}
        membersFetcher={vi.fn().mockResolvedValue([])}
        boardFetcher={vi.fn().mockResolvedValue(mockBoard)}
        tasksFetcher={vi.fn().mockResolvedValue([])}
        aiSummaryFetcher={aiSummaryFetcher}
        aiCapabilitiesFetcher={vi.fn().mockResolvedValue({
          projectId: mockProject.id,
          canUseAIAssistant: true,
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('open-ai-assistant-modal-btn')).toBeInTheDocument();
    });

    const aiButton = screen.getByTestId('open-ai-assistant-modal-btn');
    expect(aiButton).toHaveTextContent('Asistente IA');

    // No se llama a la API de IA automáticamente
    expect(aiSummaryFetcher).not.toHaveBeenCalled();
    // El modal de IA no debe estar visible inicialmente
    expect(screen.queryByRole('dialog', { name: /asistente ia/i })).toBeNull();
  });

  it('abre el modal del asistente IA al hacer clic en el botón', async () => {
    const aiSummaryFetcher = vi.fn();
    const onBack = vi.fn();

    render(
      <ProjectDetail
        project={mockProject}
        onBack={onBack}
        membersFetcher={vi.fn().mockResolvedValue([])}
        boardFetcher={vi.fn().mockResolvedValue(mockBoard)}
        tasksFetcher={vi.fn().mockResolvedValue([])}
        aiSummaryFetcher={aiSummaryFetcher}
        aiCapabilitiesFetcher={vi.fn().mockResolvedValue({
          projectId: mockProject.id,
          canUseAIAssistant: true,
        })}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('open-ai-assistant-modal-btn')).toBeInTheDocument();
    });

    const aiButton = screen.getByTestId('open-ai-assistant-modal-btn');
    fireEvent.click(aiButton);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Asistente de Gestión y Seguimiento IA')).toBeInTheDocument();
    expect(screen.getByTestId('generate-ai-analysis-btn')).toBeInTheDocument();

    // Aún no debe haberse llamado a la IA hasta que se pulse generar en el modal
    expect(aiSummaryFetcher).not.toHaveBeenCalled();
  });

  it('oculta el botón "Asistente IA" cuando el servidor indica canUseAIAssistant=false', async () => {
    const aiCapabilitiesFetcher = vi.fn().mockResolvedValue({
      projectId: mockProject.id,
      canUseAIAssistant: false,
    });

    render(
      <ProjectDetail
        project={mockProject}
        onBack={vi.fn()}
        membersFetcher={vi.fn().mockResolvedValue([])}
        boardFetcher={vi.fn().mockResolvedValue(mockBoard)}
        tasksFetcher={vi.fn().mockResolvedValue([])}
        aiCapabilitiesFetcher={aiCapabilitiesFetcher}
      />,
    );

    await waitFor(() => {
      expect(aiCapabilitiesFetcher).toHaveBeenCalledWith(
        mockProject.id,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    expect(screen.queryByTestId('open-ai-assistant-modal-btn')).toBeNull();
  });

  it('oculta el botón "Asistente IA" si falla la consulta de capacidades (fail-closed)', async () => {
    const aiCapabilitiesFetcher = vi.fn().mockRejectedValue(new Error('Network error'));

    render(
      <ProjectDetail
        project={mockProject}
        onBack={vi.fn()}
        membersFetcher={vi.fn().mockResolvedValue([])}
        boardFetcher={vi.fn().mockResolvedValue(mockBoard)}
        tasksFetcher={vi.fn().mockResolvedValue([])}
        aiCapabilitiesFetcher={aiCapabilitiesFetcher}
      />,
    );

    await waitFor(() => {
      expect(aiCapabilitiesFetcher).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByTestId('open-ai-assistant-modal-btn')).toBeNull();
  });

  it('oculta inmediatamente el botón al cambiar de proyecto y evita que una respuesta tardía de A habilite B', async () => {
    const projectB: ProjectResponse = {
      ...mockProject,
      id: 'proj-002',
      title: 'Proyecto B Sin Acceso IA',
    };
    const boardB: BoardResponse = { ...mockBoard, projectId: projectB.id };

    let resolveB!: (value: ProjectAICapabilitiesResponse) => void;
    const pendingB = new Promise<ProjectAICapabilitiesResponse>((res) => {
      resolveB = res;
    });

    const aiCapabilitiesFetcher = vi.fn((projectId: string) => {
      if (projectId === mockProject.id) {
        return Promise.resolve({ projectId: mockProject.id, canUseAIAssistant: true });
      }
      return pendingB;
    });

    const commonProps = {
      onBack: vi.fn(),
      membersFetcher: vi.fn().mockResolvedValue([]),
      boardFetcher: vi.fn((id: string) => Promise.resolve(id === projectB.id ? boardB : mockBoard)),
      tasksFetcher: vi.fn().mockResolvedValue([]),
      aiCapabilitiesFetcher,
    };

    const { rerender } = render(<ProjectDetail project={mockProject} {...commonProps} />);

    // 1. Proyecto A con canUseAIAssistant: true muestra el botón
    await waitFor(() => {
      expect(screen.getByTestId('open-ai-assistant-modal-btn')).toBeInTheDocument();
    });

    // 2. Cambiar al proyecto B mientras su petición sigue pendiente
    rerender(<ProjectDetail project={projectB} {...commonProps} />);

    // 3. El botón desaparece inmediatamente mientras se consulta el permiso de B
    expect(screen.queryByTestId('open-ai-assistant-modal-btn')).toBeNull();

    // 4. Resolver permiso de B con false y confirmar que sigue oculto
    resolveB({ projectId: projectB.id, canUseAIAssistant: false });
    await waitFor(() => {
      expect(aiCapabilitiesFetcher).toHaveBeenCalledWith(
        projectB.id,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
    expect(screen.queryByTestId('open-ai-assistant-modal-btn')).toBeNull();
  });

  it('ignora una respuesta tardía de capacidades del proyecto A tras cambiar al proyecto B', async () => {
    const projectB: ProjectResponse = {
      ...mockProject,
      id: 'proj-002',
      title: 'Proyecto B Sin Acceso IA',
    };
    const boardB: BoardResponse = { ...mockBoard, projectId: projectB.id };

    let resolveA!: (value: ProjectAICapabilitiesResponse) => void;
    const pendingA = new Promise<ProjectAICapabilitiesResponse>((res) => {
      resolveA = res;
    });

    const aiCapabilitiesFetcher = vi.fn((projectId: string) => {
      if (projectId === mockProject.id) {
        return pendingA;
      }
      return Promise.resolve({ projectId: projectB.id, canUseAIAssistant: false });
    });

    const commonProps = {
      onBack: vi.fn(),
      membersFetcher: vi.fn().mockResolvedValue([]),
      boardFetcher: vi.fn((id: string) => Promise.resolve(id === projectB.id ? boardB : mockBoard)),
      tasksFetcher: vi.fn().mockResolvedValue([]),
      aiCapabilitiesFetcher,
    };

    const { rerender } = render(<ProjectDetail project={mockProject} {...commonProps} />);
    expect(screen.queryByTestId('open-ai-assistant-modal-btn')).toBeNull();

    rerender(<ProjectDetail project={projectB} {...commonProps} />);

    await waitFor(() => {
      expect(aiCapabilitiesFetcher).toHaveBeenCalledWith(
        projectB.id,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    // Resolver tardíamente A con true no debe habilitar el botón para B
    resolveA({ projectId: mockProject.id, canUseAIAssistant: true });
    await Promise.resolve();
    expect(screen.queryByTestId('open-ai-assistant-modal-btn')).toBeNull();
  });
});
