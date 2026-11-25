import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProjectAIAssistantModal } from './ProjectAIAssistantModal.js';
import { AIAssistantServiceError } from '../services/ai-assistant.service.js';
import type { AIAnalysisResponse } from '@is488/shared';

const mockSuccessResponse: AIAnalysisResponse = {
  projectId: 'a0000000-0000-0000-0000-000000000001',
  analysis: {
    progressSummary: 'El equipo ha completado el 60% de los entregables del sprint.',
    riskSignals: [
      'Cuello de botella en la fase de pruebas.',
      'Dos tareas críticas sin responsable asignado.',
    ],
    nextSteps: [
      'Priorizar la resolución de bugs bloqueantes.',
      'Asignar revisor al módulo de autenticación.',
    ],
  },
  meta: {
    generatedAt: '2026-11-23T20:30:00.000Z',
    model: 'fake-ai-model-v1',
    disclaimer:
      'Orientación formativa generada por IA. No constituye calificación ni evaluación académica oficial.',
  },
};

describe('ProjectAIAssistantModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no se renderiza en el DOM cuando isOpen es false', () => {
    render(
      <ProjectAIAssistantModal
        isOpen={false}
        projectId="proj-123"
        projectTitle="Sistema Académico"
        onClose={onClose}
      />,
    );

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('muestra el estado inicial (idle) con botón para generar análisis cuando isOpen es true', () => {
    render(
      <ProjectAIAssistantModal
        isOpen={true}
        projectId="proj-123"
        projectTitle="Sistema Académico"
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Asistente de Gestión y Seguimiento IA')).toBeInTheDocument();
    expect(screen.getByText('Sistema Académico')).toBeInTheDocument();
    expect(screen.getByTestId('generate-ai-analysis-btn')).toBeInTheDocument();
    expect(screen.getByText('Iniciar Análisis con IA')).toBeInTheDocument();
  });

  it('no contiene ningún campo de chat libre ni controles de calificación académica', () => {
    render(
      <ProjectAIAssistantModal
        isOpen={true}
        projectId="proj-123"
        projectTitle="Sistema Académico"
        onClose={onClose}
      />,
    );

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByPlaceholderText(/escribe/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/pregunta/i)).toBeNull();
    expect(screen.queryByText(/calificación/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nota/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/evaluar/i)).not.toBeInTheDocument();
  });

  it('muestra estado de carga accesible con role="status" y aria-live="polite" mientras se genera el análisis', async () => {
    let resolvePromise: (value: AIAnalysisResponse) => void = () => {};
    const pendingPromise = new Promise<AIAnalysisResponse>((resolve) => {
      resolvePromise = resolve;
    });
    const summaryFetcher = vi.fn().mockReturnValue(pendingPromise);

    render(
      <ProjectAIAssistantModal
        isOpen={true}
        projectId="proj-123"
        projectTitle="Sistema Académico"
        onClose={onClose}
        summaryFetcher={summaryFetcher}
      />,
    );

    fireEvent.click(screen.getByTestId('generate-ai-analysis-btn'));

    expect(screen.getByTestId('ai-assistant-loading')).toBeInTheDocument();
    const loadingStatus = screen.getByRole('status');
    expect(loadingStatus).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Analizando el estado del proyecto...')).toBeInTheDocument();
    expect(
      screen.getByText('Procesando tablero Kanban, tareas y métricas de avance operativo.'),
    ).toBeInTheDocument();

    // Resolve
    resolvePromise(mockSuccessResponse);
    await waitFor(() => {
      expect(screen.queryByTestId('ai-assistant-loading')).toBeNull();
    });
  });

  it('muestra el resultado exitoso con el disclaimer visible, las 3 secciones estructuradas y metadatos', async () => {
    const summaryFetcher = vi.fn().mockResolvedValue(mockSuccessResponse);

    render(
      <ProjectAIAssistantModal
        isOpen={true}
        projectId="proj-123"
        projectTitle="Sistema Académico"
        onClose={onClose}
        summaryFetcher={summaryFetcher}
      />,
    );

    fireEvent.click(screen.getByTestId('generate-ai-analysis-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-assistant-success')).toBeInTheDocument();
    });

    // Disclaimer banner
    const disclaimer = screen.getByTestId('ai-assistant-disclaimer');
    expect(disclaimer).toBeInTheDocument();
    expect(disclaimer).toHaveAttribute('role', 'note');
    expect(disclaimer).toHaveTextContent(
      'Orientación formativa generada por IA. No constituye calificación ni evaluación académica oficial.',
    );

    // 3 structured sections
    const progressSummary = screen.getByTestId('ai-progress-summary');
    expect(progressSummary).toHaveTextContent(
      'El equipo ha completado el 60% de los entregables del sprint.',
    );

    const riskSignals = screen.getByTestId('ai-risk-signals');
    expect(riskSignals).toHaveTextContent('Cuello de botella en la fase de pruebas.');
    expect(riskSignals).toHaveTextContent('Dos tareas críticas sin responsable asignado.');

    const nextSteps = screen.getByTestId('ai-next-steps');
    expect(nextSteps).toHaveTextContent('Priorizar la resolución de bugs bloqueantes.');
    expect(nextSteps).toHaveTextContent('Asignar revisor al módulo de autenticación.');

    // Metadata
    expect(screen.getByText(/fake-ai-model-v1/)).toBeInTheDocument();
    expect(screen.getByTestId('refresh-ai-analysis-btn')).toBeInTheDocument();
  });

  it('maneja error 429 con mensaje comprensible e información de reintento', async () => {
    const summaryFetcher = vi
      .fn()
      .mockRejectedValue(
        new AIAssistantServiceError(
          429,
          'Has alcanzado el límite de análisis para este proyecto. Podrás generar uno nuevo en 4 minutos.',
          'RATE_LIMIT_EXCEEDED',
          240,
        ),
      );

    render(
      <ProjectAIAssistantModal
        isOpen={true}
        projectId="proj-123"
        projectTitle="Sistema Académico"
        onClose={onClose}
        summaryFetcher={summaryFetcher}
      />,
    );

    fireEvent.click(screen.getByTestId('generate-ai-analysis-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-assistant-error')).toBeInTheDocument();
    });

    const errorAlert = screen.getByRole('alert');
    expect(errorAlert).toHaveAttribute('aria-live', 'assertive');
    expect(errorAlert).toHaveTextContent('Has alcanzado el límite de análisis para este proyecto');
    expect(errorAlert).toHaveTextContent('Tiempo estimado de espera: 240 segundos.');
    expect(screen.getByTestId('retry-ai-analysis-btn')).toBeInTheDocument();
  });

  it('maneja error 504 de timeout adecuadamente', async () => {
    const summaryFetcher = vi
      .fn()
      .mockRejectedValue(
        new AIAssistantServiceError(
          504,
          'El asistente tardó demasiado en responder (timeout de 8 segundos). Por favor intenta nuevamente.',
          'GATEWAY_TIMEOUT',
        ),
      );

    render(
      <ProjectAIAssistantModal
        isOpen={true}
        projectId="proj-123"
        projectTitle="Sistema Académico"
        onClose={onClose}
        summaryFetcher={summaryFetcher}
      />,
    );

    fireEvent.click(screen.getByTestId('generate-ai-analysis-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-assistant-error')).toBeInTheDocument();
    });

    expect(screen.getByText(/timeout de 8 segundos/i)).toBeInTheDocument();
  });

  it('maneja error 503 de proveedor no disponible adecuadamente', async () => {
    const summaryFetcher = vi
      .fn()
      .mockRejectedValue(
        new AIAssistantServiceError(
          503,
          'El servicio de IA no está configurado o no se encuentra disponible temporalmente.',
          'PROVIDER_UNAVAILABLE',
        ),
      );

    render(
      <ProjectAIAssistantModal
        isOpen={true}
        projectId="proj-123"
        projectTitle="Sistema Académico"
        onClose={onClose}
        summaryFetcher={summaryFetcher}
      />,
    );

    fireEvent.click(screen.getByTestId('generate-ai-analysis-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-assistant-error')).toBeInTheDocument();
    });

    expect(screen.getByText(/no se encuentra disponible temporalmente/i)).toBeInTheDocument();
  });

  it('maneja error 502 de respuesta inválida adecuadamente', async () => {
    const summaryFetcher = vi
      .fn()
      .mockRejectedValue(
        new AIAssistantServiceError(
          502,
          'La respuesta del proveedor de IA no cumplió con el formato estructurado esperado.',
          'BAD_GATEWAY',
        ),
      );

    render(
      <ProjectAIAssistantModal
        isOpen={true}
        projectId="proj-123"
        projectTitle="Sistema Académico"
        onClose={onClose}
        summaryFetcher={summaryFetcher}
      />,
    );

    fireEvent.click(screen.getByTestId('generate-ai-analysis-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-assistant-error')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/no cumplió con el formato estructurado esperado/i),
    ).toBeInTheDocument();
  });

  it('cierra el modal al pulsar la tecla Escape', () => {
    render(
      <ProjectAIAssistantModal
        isOpen={true}
        projectId="proj-123"
        projectTitle="Sistema Académico"
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cierra el modal al pulsar el botón de cerrar', () => {
    render(
      <ProjectAIAssistantModal
        isOpen={true}
        projectId="proj-123"
        projectTitle="Sistema Académico"
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByTestId('close-ai-assistant-modal-btn'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
