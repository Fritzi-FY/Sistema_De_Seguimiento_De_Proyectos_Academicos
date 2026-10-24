import { describe, it, expect } from 'vitest';
import {
  CreateBoardColumnSchema,
  UpdateBoardColumnSchema,
  DeleteBoardColumnQuerySchema,
  BoardColumnResponseSchema,
  BoardResponseSchema,
} from './board.contract.js';

describe('CreateBoardColumnSchema', () => {
  const validBasePayload = {
    name: 'Por revisar',
    color: '#3b82f6',
    category: 'IN_REVIEW' as const,
  };

  it('debe validar exitosamente un payload completo y válido', () => {
    const result = CreateBoardColumnSchema.safeParse(validBasePayload);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Por revisar');
      expect(result.data.color).toBe('#3b82f6');
      expect(result.data.category).toBe('IN_REVIEW');
    }
  });

  it('debe aplicar la categoría TODO por defecto si no se especifica', () => {
    const result = CreateBoardColumnSchema.safeParse({ name: 'Backlog' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe('TODO');
    }
  });

  it('debe aceptar colores hexadecimales cortos (#fff) y largos (#3b82f6)', () => {
    const resultShort = CreateBoardColumnSchema.safeParse({ name: 'Col 1', color: '#abc' });
    const resultLong = CreateBoardColumnSchema.safeParse({ name: 'Col 2', color: '#10b981' });

    expect(resultShort.success).toBe(true);
    expect(resultLong.success).toBe(true);
  });

  it('debe rechazar nombres vacíos o compuestos únicamente por espacios', () => {
    const resultEmpty = CreateBoardColumnSchema.safeParse({ name: '' });
    const resultSpaces = CreateBoardColumnSchema.safeParse({ name: '   ' });

    expect(resultEmpty.success).toBe(false);
    expect(resultSpaces.success).toBe(false);
  });

  it('debe rechazar nombres que superen los 50 caracteres', () => {
    const longName = 'A'.repeat(51);
    const result = CreateBoardColumnSchema.safeParse({ name: longName });

    expect(result.success).toBe(false);
  });

  it('debe rechazar colores que no cumplan el formato hexadecimal', () => {
    const invalidColors = ['red', '#12345', '#gggggg', '123456', '#1234567'];

    for (const color of invalidColors) {
      const result = CreateBoardColumnSchema.safeParse({ name: 'Columna', color });
      expect(result.success).toBe(false);
    }
  });

  it('debe rechazar categorías no reconocidas', () => {
    const result = CreateBoardColumnSchema.safeParse({
      name: 'Columna',
      category: 'INVALID_CATEGORY',
    });

    expect(result.success).toBe(false);
  });

  it('debe rechazar campos adicionales desconocidos (additionalProperties: false)', () => {
    const result = CreateBoardColumnSchema.safeParse({
      name: 'Columna Valida',
      extraField: 'no permitido',
    });

    expect(result.success).toBe(false);
  });
});

describe('UpdateBoardColumnSchema', () => {
  it('debe validar actualizaciones parciales de nombre', () => {
    const result = UpdateBoardColumnSchema.safeParse({ name: 'En progreso activo' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('En progreso activo');
    }
  });

  it('debe validar actualizaciones de orderIndex válido (>= 0)', () => {
    const result = UpdateBoardColumnSchema.safeParse({ orderIndex: 3 });

    expect(result.success).toBe(true);
  });

  it('debe rechazar un payload vacío sin ningún campo', () => {
    const result = UpdateBoardColumnSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it('debe rechazar orderIndex negativo o decimal', () => {
    const resultNegative = UpdateBoardColumnSchema.safeParse({ orderIndex: -1 });
    const resultDecimal = UpdateBoardColumnSchema.safeParse({ orderIndex: 2.5 });

    expect(resultNegative.success).toBe(false);
    expect(resultDecimal.success).toBe(false);
  });

  it('debe rechazar campos adicionales desconocidos (additionalProperties: false)', () => {
    const result = UpdateBoardColumnSchema.safeParse({
      name: 'Nombre Valido',
      unexpectedProp: 12345,
    });

    expect(result.success).toBe(false);
  });

  it('debe rechazar un payload donde todos los campos son undefined', () => {
    const result = UpdateBoardColumnSchema.safeParse({
      name: undefined,
      color: undefined,
      category: undefined,
      orderIndex: undefined,
    });

    expect(result.success).toBe(false);
  });
});

describe('DeleteBoardColumnQuerySchema', () => {
  it('debe validar parámetros sin targetColumnId opcional', () => {
    const result = DeleteBoardColumnQuerySchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetColumnId).toBeUndefined();
    }
  });

  it('debe validar targetColumnId cuando es un UUID válido', () => {
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';
    const result = DeleteBoardColumnQuerySchema.safeParse({ targetColumnId: validUuid });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetColumnId).toBe(validUuid);
    }
  });

  it('debe rechazar targetColumnId que no sea un UUID válido', () => {
    const result = DeleteBoardColumnQuerySchema.safeParse({
      targetColumnId: 'invalid-uuid-format',
    });

    expect(result.success).toBe(false);
  });
});

describe('BoardColumnResponseSchema & BoardResponseSchema', () => {
  const validColumn = {
    id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    boardId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    name: 'Por hacer',
    orderIndex: 0,
    category: 'TODO' as const,
    color: '#64748b',
    createdAt: '2026-10-21T10:00:00.000Z',
    updatedAt: '2026-10-21T10:00:00.000Z',
  };

  it('debe validar una representación de columna conforme', () => {
    const result = BoardColumnResponseSchema.safeParse(validColumn);

    expect(result.success).toBe(true);
  });

  it('debe validar un tablero completo con columnas', () => {
    const validBoard = {
      id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
      projectId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
      columns: [validColumn],
      createdAt: '2026-10-21T10:00:00.000Z',
      updatedAt: '2026-10-21T10:00:00.000Z',
    };

    const result = BoardResponseSchema.safeParse(validBoard);

    expect(result.success).toBe(true);
  });

  it('debe rechazar cuando falta un campo obligatorio o id no es UUID', () => {
    const invalidBoard = {
      id: 'not-a-uuid',
      projectId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
      columns: [],
      createdAt: '2026-10-21T10:00:00.000Z',
      updatedAt: '2026-10-21T10:00:00.000Z',
    };

    const result = BoardResponseSchema.safeParse(invalidBoard);

    expect(result.success).toBe(false);
  });
});
