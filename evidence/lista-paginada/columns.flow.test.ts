import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../../apps/api/src/infrastructure/http/app.js';
import { createProject } from '../../apps/web/src/services/project.service.js';
import {
  getBoard,
  createBoardColumn,
  updateBoardColumn,
  deleteBoardColumn,
} from '../../apps/web/src/services/board.service.js';
import {
  createTask,
  getAllProjectTasks,
  getTaskActivity,
} from '../../apps/web/src/services/task.service.js';
import { DEV_IDENTITIES } from '../../apps/web/src/services/dev-identity.js';

afterEach(() => vi.unstubAllGlobals());
it('uses existing HTTP columns contracts, reorder, atomic reallocation, history and restrictions', async () => {
  const app = createApp({ nodeEnv: 'test' });
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => app.request(url, init));
  const project = await createProject({
    title: 'Gestión columnas',
    courseCode: 'IS488',
    startDate: '2026-10-26T00:00:00Z',
    targetDate: '2026-12-26T00:00:00Z',
  });
  const board = await getBoard(project.id);
  expect(board.columns.map((column) => [column.name, column.category])).toEqual([
    ['Por hacer', 'TODO'],
    ['En progreso', 'IN_PROGRESS'],
    ['Completado', 'DONE'],
  ]);
  const review = await createBoardColumn(project.id, board.id, {
    name: 'En revisión',
    category: 'IN_REVIEW',
  });
  expect(review.orderIndex).toBe(3);
  await updateBoardColumn(project.id, board.id, review.id, { name: 'Revisión final' });
  await updateBoardColumn(project.id, board.id, review.id, { orderIndex: 1 });
  let current = await getBoard(project.id);
  expect(current.columns.map((column) => column.orderIndex)).toEqual([0, 1, 2, 3]);
  expect(current.columns[1]).toMatchObject({ id: review.id, name: 'Revisión final' });
  const destination = board.columns[1]!;
  const existing = await createTask(project.id, {
    title: 'Ya en destino',
    columnId: destination.id,
  });
  const first = await createTask(project.id, { title: 'Primera trasladada', columnId: review.id });
  const second = await createTask(project.id, { title: 'Segunda trasladada', columnId: review.id });
  await expect(deleteBoardColumn(project.id, review.id)).rejects.toThrow();
  await expect(
    deleteBoardColumn(project.id, review.id, { targetColumnId: review.id }),
  ).rejects.toThrow();
  await expect(
    deleteBoardColumn(project.id, review.id, { targetColumnId: DEV_IDENTITIES.teacher.userId }),
  ).rejects.toThrow();
  await expect(
    updateBoardColumn(
      project.id,
      board.id,
      review.id,
      { name: 'Ajena' },
      DEV_IDENTITIES.otherStudent,
    ),
  ).rejects.toThrow();
  expect(
    await deleteBoardColumn(project.id, review.id, { targetColumnId: destination.id }),
  ).toEqual({ success: true, deletedColumnId: review.id, migratedTasksCount: 2 });
  const tasks = await getAllProjectTasks(project.id);
  expect(
    tasks
      .filter((task) => task.columnId === destination.id)
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((task) => [task.id, task.orderIndex]),
  ).toEqual([
    [existing.id, 0],
    [first.id, 1],
    [second.id, 2],
  ]);
  const history = await getTaskActivity(project.id, first.id);
  expect(history.find((event) => event.action === 'COLUMN_DELETED_REALLOCATION')).toMatchObject({
    fromColumnId: review.id,
    toColumnId: destination.id,
    actorId: DEV_IDENTITIES.student.userId,
  });
  expect((await getBoard(project.id)).columns.some((column) => column.id === review.id)).toBe(
    false,
  );
  expect(await deleteBoardColumn(project.id, board.columns[0]!.id)).toMatchObject({
    migratedTasksCount: 0,
  });
  await deleteBoardColumn(project.id, board.columns[2]!.id);
  current = await getBoard(project.id);
  expect(current.columns).toHaveLength(1);
  await expect(deleteBoardColumn(project.id, destination.id)).rejects.toThrow();
  expect(await getAllProjectTasks(project.id)).toEqual(tasks);
});
