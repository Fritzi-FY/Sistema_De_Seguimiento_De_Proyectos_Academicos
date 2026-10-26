import { describe, expect, it } from 'vitest';
import { closestCorners } from '@dnd-kit/core';
import type { CollisionDetection } from '@dnd-kit/core';
import { kanbanCollisionDetection } from './KanbanBoard.js';

function rect(left: number, top: number, width: number, height: number) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function geometry(x: number, y: number): Parameters<CollisionDetection>[0] {
  const rectangles = new Map([
    ['column:todo', rect(0, 0, 320, 5000)],
    ['column:progress', rect(340, 0, 320, 5000)],
    ['column:done', rect(680, 0, 320, 5000)],
    ...Array.from(
      { length: 21 },
      (_, index) => [`task-${index + 1}`, rect(16, 100 + index * 220, 288, 200)] as const,
    ),
  ]);
  const movedRect = rect(x - 140, y - 100, 288, 200);
  return {
    active: {
      id: 'task-1',
      data: { current: {} },
      rect: { current: { initial: rectangles.get('task-1')!, translated: movedRect } },
    },
    collisionRect: movedRect,
    droppableRects: rectangles,
    droppableContainers: [...rectangles].map(([id, value]) => ({
      id,
      key: id,
      disabled: false,
      data: { current: {} },
      node: { current: null },
      rect: { current: value },
    })),
    pointerCoordinates: { x, y },
  };
}

describe('Kanban collision geometry with 21 source cards and empty destinations', () => {
  it.each([
    ['progress', 490, 180],
    ['done', 830, 180],
    ['progress', 490, 600],
    ['done', 830, 600],
    ['progress', 490, 4500],
    ['done', 830, 4500],
  ] as const)(
    'detects empty %s at pointer (%i, %i), including empty message and lower visible area',
    (column, x, y) => {
      expect(kanbanCollisionDetection(geometry(x, y))[0]?.id).toBe(`column:${column}`);
    },
  );

  it('prefers the card over its containing column for within-column ordering', () => {
    expect(kanbanCollisionDetection(geometry(160, 400))[0]?.id).toBe('task-2');
  });

  it('does not invent a pointer destination outside every droppable', () => {
    expect(kanbanCollisionDetection(geometry(1100, 400))).toEqual([]);
  });

  it('preserves closestCorners for keyboard navigation without pointer coordinates', () => {
    const args = { ...geometry(490, 180), pointerCoordinates: null };
    expect(kanbanCollisionDetection(args)).toEqual(closestCorners(args));
  });
});
