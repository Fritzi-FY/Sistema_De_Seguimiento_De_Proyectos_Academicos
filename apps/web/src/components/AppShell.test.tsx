import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { HealthResponse } from '@is488/shared';
import { AppShell } from './AppShell.js';

describe('AppShell Component (Frontend SPA Baseline)', () => {
  it('debe mostrar el estado de carga inicialmente mientras se consulta el backend', () => {
    // Retrasar resolución para observar el estado de carga
    const pendingPromise = new Promise<HealthResponse>(() => {});
    const mockFetcher = vi.fn().mockReturnValue(pendingPromise);

    render(<AppShell healthFetcher={mockFetcher} />);

    expect(screen.getByRole('status', { busy: true })).toBeInTheDocument();
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

    render(<AppShell healthFetcher={mockFetcher} />);

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

    render(<AppShell healthFetcher={mockFetcher} />);

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

    render(<AppShell healthFetcher={mockFetcher} />);

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
});
