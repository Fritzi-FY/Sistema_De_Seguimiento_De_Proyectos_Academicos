import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TaskFiltersBar } from './TaskFiltersBar.js';

const columnId = '11111111-1111-4111-8111-111111111111';
const props = {
  columns: [
    {
      id: columnId,
      boardId: columnId,
      name: 'Por hacer',
      orderIndex: 0,
      category: 'TODO' as const,
      createdAt: '',
      updatedAt: '',
    },
  ],
  columnsLoading: false,
  columnsError: null,
  onRetryColumns: () => {},
};

describe('TaskFiltersBar', () => {
  it('normaliza texto y etiqueta, combina los cuatro filtros y limpia el borrador', () => {
    const apply = vi.fn();
    render(<TaskFiltersBar {...props} onApply={apply} />);
    fireEvent.change(screen.getByLabelText('Buscar texto'), {
      target: { value: '  análisis & QA  ' },
    });
    fireEvent.change(screen.getByLabelText('Etiqueta exacta'), { target: { value: '  UX  ' } });
    fireEvent.change(screen.getByLabelText('Columna'), { target: { value: columnId } });
    fireEvent.change(screen.getByLabelText('Prioridad'), { target: { value: 'HIGH' } });
    fireEvent.change(screen.getByLabelText('Responsable (UUID)'), {
      target: { value: ` ${columnId} ` },
    });
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    expect(apply).toHaveBeenLastCalledWith({
      search: 'análisis & QA',
      label: 'UX',
      columnId,
      priority: 'HIGH',
      assigneeId: columnId,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(apply).toHaveBeenLastCalledWith({});
    expect(screen.getByLabelText('Buscar texto')).toHaveValue('');
    expect(screen.getByLabelText('Columna')).toHaveValue('');
    expect(screen.getByLabelText('Prioridad')).toHaveValue('');
    expect(screen.getByLabelText('Etiqueta exacta')).toHaveValue('');
    expect(screen.getByLabelText('Responsable (UUID)')).toHaveValue('');
  });

  it.each([
    ['Buscar texto', 100],
    ['Etiqueta exacta', 30],
  ] as const)('valida el límite de %s y asocia el error al campo', (name, limit) => {
    const apply = vi.fn();
    render(<TaskFiltersBar {...props} onApply={apply} />);
    fireEvent.change(screen.getByLabelText(name), { target: { value: 'x'.repeat(limit + 1) } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveAttribute(
      'id',
      screen.getByLabelText(name).getAttribute('aria-describedby'),
    );
    fireEvent.change(screen.getByLabelText(name), { target: { value: 'x'.repeat(limit) } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('omite todos los campos vacíos o con espacios', () => {
    const apply = vi.fn();
    render(<TaskFiltersBar {...props} onApply={apply} />);
    fireEvent.change(screen.getByLabelText('Buscar texto'), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText('Etiqueta exacta'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    expect(apply).toHaveBeenCalledWith({});
  });

  it('rechaza responsable textual y asocia el error sin enviar filtros', () => {
    const apply = vi.fn();
    render(<TaskFiltersBar {...props} onApply={apply} />);
    fireEvent.change(screen.getByLabelText('Responsable (UUID)'), {
      target: { value: 'dev-student-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveAttribute(
      'id',
      screen.getByLabelText('Responsable (UUID)').getAttribute('aria-describedby'),
    );
  });
});
