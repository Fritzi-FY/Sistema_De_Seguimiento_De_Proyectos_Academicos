import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createBoardColumn,
  updateBoardColumn,
  deleteBoardColumn,
  getBoard,
} from './board.service.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const boardId = '22222222-2222-4222-8222-222222222222';
const columnId = '33333333-3333-4333-8333-333333333333';
const column = {
  id: columnId,
  boardId,
  name: 'Revisión',
  category: 'IN_REVIEW',
  orderIndex: 3,
  createdAt: '2026-10-26T00:00:00Z',
  updatedAt: '2026-10-26T00:00:00Z',
};
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

it('creates and updates with exact payload, headers and signal', async () => {
  vi.mocked(fetch).mockImplementation(async () => response(column));
  const controller = new AbortController();
  expect(
    await createBoardColumn(
      projectId,
      boardId,
      { name: ' Revisión ', category: 'IN_REVIEW' },
      undefined,
      { signal: controller.signal },
    ),
  ).toEqual(column);
  expect(fetch).toHaveBeenLastCalledWith(
    `/api/projects/${projectId}/board/columns`,
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'Revisión', category: 'IN_REVIEW' }),
      signal: controller.signal,
      headers: expect.objectContaining({ 'X-Dev-User-Id': projectId }),
    }),
  );
  await updateBoardColumn(projectId, boardId, columnId, { orderIndex: 1 });
  expect(fetch).toHaveBeenLastCalledWith(
    `/api/projects/${projectId}/board/columns/${columnId}`,
    expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ orderIndex: 1 }) }),
  );
});
it('rejects invalid payloads before HTTP', async () => {
  await expect(
    createBoardColumn(projectId, boardId, { name: ' ', category: 'TODO' }),
  ).rejects.toThrow();
  await expect(
    updateBoardColumn(projectId, boardId, columnId, { orderIndex: -1 }),
  ).rejects.toThrow();
  await expect(
    deleteBoardColumn(projectId, columnId, { targetColumnId: 'text' }),
  ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it.each([{ ...column, boardId: projectId }, { ...column, category: 'INVALID' }, {}])(
  'rejects invalid creation response %j',
  async (data) => {
    vi.mocked(fetch).mockResolvedValue(response(data));
    await expect(
      createBoardColumn(projectId, boardId, { name: 'Revisión', category: 'IN_REVIEW' }),
    ).rejects.toThrow();
  },
);
it('rejects another column on update and another project on board read', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(response({ ...column, id: projectId }));
  await expect(
    updateBoardColumn(projectId, boardId, columnId, { name: 'Nueva' }),
  ).rejects.toThrow();
  vi.mocked(fetch).mockResolvedValueOnce(
    response({
      id: boardId,
      projectId: boardId,
      columns: [column],
      createdAt: column.createdAt,
      updatedAt: column.updatedAt,
    }),
  );
  await expect(getBoard(projectId)).rejects.toThrow();
});
it('deletes with explicit destination and validates existing OpenAPI result', async () => {
  const data = { success: true, deletedColumnId: columnId, migratedTasksCount: 2 };
  vi.mocked(fetch).mockResolvedValue(response(data));
  expect(await deleteBoardColumn(projectId, columnId, { targetColumnId: projectId })).toEqual(data);
  expect(fetch).toHaveBeenCalledWith(
    `/api/projects/${projectId}/board/columns/${columnId}?targetColumnId=${projectId}`,
    expect.objectContaining({ method: 'DELETE' }),
  );
});
it.each([
  null,
  {},
  { success: false, deletedColumnId: columnId, migratedTasksCount: 0 },
  { success: true, deletedColumnId: projectId, migratedTasksCount: 0 },
  { success: true, deletedColumnId: columnId, migratedTasksCount: -1 },
  { success: true, deletedColumnId: columnId, migratedTasksCount: 1.5 },
])('rejects invalid deletion acknowledgement %j', async (data) => {
  vi.mocked(fetch).mockResolvedValue(response(data));
  await expect(deleteBoardColumn(projectId, columnId)).rejects.toThrow();
});
it.each([400, 401, 404, 409, 500])('preserves visible backend errors %i', async (status) => {
  vi.mocked(fetch).mockImplementation(async () =>
    response({ message: 'Restricción del servidor' }, status),
  );
  await expect(deleteBoardColumn(projectId, columnId)).rejects.toThrow('Restricción del servidor');
  await expect(updateBoardColumn(projectId, boardId, columnId, { name: 'Nombre' })).rejects.toThrow(
    'Restricción del servidor',
  );
  await expect(
    createBoardColumn(projectId, boardId, { name: 'Nombre', category: 'TODO' }),
  ).rejects.toThrow('Restricción del servidor');
});
it('propagates transport failure without retries', async () => {
  vi.mocked(fetch).mockRejectedValue(new Error('Sin conexión'));
  await expect(deleteBoardColumn(projectId, columnId)).rejects.toThrow('Sin conexión');
  expect(fetch).toHaveBeenCalledTimes(1);
});
