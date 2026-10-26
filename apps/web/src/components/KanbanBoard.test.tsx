/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { BoardResponse, TaskResponse } from '@is488/shared';
import { getAllProjectTasks } from '../services/task.service.js';
import { KanbanBoard, moveTasks } from './KanbanBoard.js';

describe('KanbanBoard Component', () => {
  const sampleProjectId = '11111111-1111-4111-8111-111111111111';

  const sampleBoard: BoardResponse = {
    id: '22222222-2222-4222-8222-222222222222',
    projectId: sampleProjectId,
    columns: [
      {
        id: 'col-2',
        boardId: '22222222-2222-4222-8222-222222222222',
        name: 'En Progreso',
        orderIndex: 1,
        category: 'IN_PROGRESS',
        createdAt: '2026-10-20T10:00:00.000Z',
        updatedAt: '2026-10-20T10:00:00.000Z',
      },
      {
        id: 'col-1',
        boardId: '22222222-2222-4222-8222-222222222222',
        name: 'Por Hacer',
        orderIndex: 0,
        category: 'TODO',
        createdAt: '2026-10-20T10:00:00.000Z',
        updatedAt: '2026-10-20T10:00:00.000Z',
      },
      {
        id: 'col-3',
        boardId: '22222222-2222-4222-8222-222222222222',
        name: 'Completado',
        orderIndex: 2,
        category: 'DONE',
        createdAt: '2026-10-20T10:00:00.000Z',
        updatedAt: '2026-10-20T10:00:00.000Z',
      },
    ],
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
  };

  const makeTask = (
    id: string,
    colId: string,
    orderIndex: number,
    title: string,
  ): TaskResponse => ({
    id,
    projectId: sampleProjectId,
    columnId: colId,
    title,
    priority: 'MEDIUM',
    orderIndex,
    labels: [],
    creatorId: 'dev-student-01',
    assigneeIds: [],
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('debe mostrar el indicador de carga inicialmente', () => {
    // Fetcher que no resuelve inmediatamente
    const pendingBoardFetcher = vi.fn().mockReturnValue(new Promise(() => {}));
    const pendingTasksFetcher = vi.fn().mockReturnValue(new Promise(() => {}));

    render(
      <KanbanBoard
        projectId={sampleProjectId}
        boardFetcher={pendingBoardFetcher}
        tasksFetcher={pendingTasksFetcher}
      />,
    );

    expect(screen.getByTestId('kanban-board-loading')).toBeInTheDocument();
    expect(screen.getByText('Cargando tablero Kanban...')).toBeInTheDocument();
  });

  it('reindexa de forma contigua movimientos intra-columna, entre columnas y a una vacía', () => {
    const tasks = [
      makeTask('t1', 'col-1', 0, 'Uno'),
      makeTask('t2', 'col-1', 1, 'Dos'),
      makeTask('t3', 'col-1', 2, 'Tres'),
      makeTask('t4', 'col-2', 0, 'Cuatro'),
    ];

    const reordered = moveTasks(tasks, 't1', 'col-1', 2);
    expect(
      reordered
        .filter((task) => task.columnId === 'col-1')
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((task) => task.id),
    ).toEqual(['t2', 't3', 't1']);
    expect(
      reordered
        .filter((task) => task.columnId === 'col-1')
        .map((task) => task.orderIndex)
        .sort(),
    ).toEqual([0, 1, 2]);

    const transferred = moveTasks(tasks, 't2', 'col-2', 1);
    expect(
      transferred
        .filter((task) => task.columnId === 'col-1')
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((task) => task.id),
    ).toEqual(['t1', 't3']);
    expect(
      transferred
        .filter((task) => task.columnId === 'col-2')
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((task) => task.id),
    ).toEqual(['t4', 't2']);
    expect(
      transferred
        .filter((task) => task.columnId === 'col-1')
        .map((task) => task.orderIndex)
        .sort(),
    ).toEqual([0, 1]);

    const empty = moveTasks(tasks, 't1', 'col-3', 0);
    expect(empty.find((task) => task.id === 't1')).toMatchObject({
      columnId: 'col-3',
      orderIndex: 0,
    });
    expect(empty.filter((task) => task.columnId === 'col-3')).toHaveLength(1);
  });

  it('no-op no envía movimiento y mantiene el orden solicitado', async () => {
    const task = makeTask('t-noop', 'col-1', 0, 'Sin cambios');
    const taskMover = vi.fn();
    render(
      <KanbanBoard
        projectId={sampleProjectId}
        boardFetcher={vi.fn().mockResolvedValue(sampleBoard)}
        tasksFetcher={vi.fn().mockResolvedValue([task])}
        taskMover={taskMover}
      />,
    );

    await waitFor(() => expect(screen.getByText('Sin cambios')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Arrastrar tarea Sin cambios' })).toBeEnabled();
    expect(taskMover).not.toHaveBeenCalled();
  });

  it('cancela el movimiento por teclado sin enviar una mutación y conserva el foco', async () => {
    const task = makeTask('t-pending', 'col-1', 0, 'Movimiento pendiente');
    const taskMover = vi.fn();
    render(
      <KanbanBoard
        projectId={sampleProjectId}
        boardFetcher={vi.fn().mockResolvedValue(sampleBoard)}
        tasksFetcher={vi.fn().mockResolvedValue([task])}
        taskMover={taskMover}
      />,
    );

    await waitFor(() => expect(screen.getByText('Movimiento pendiente')).toBeInTheDocument());
    const handle = screen.getByRole('button', { name: 'Arrastrar tarea Movimiento pendiente' });
    handle.focus();
    await act(async () => {
      fireEvent.keyDown(handle, { key: ' ', code: 'Space' });
      fireEvent.keyDown(handle, { key: 'ArrowRight', code: 'ArrowRight' });
      fireEvent.keyDown(handle, { key: 'Escape', code: 'Escape' });
    });

    expect(taskMover).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(handle);
    expect(
      screen.getByRole('heading', { level: 4, name: 'Movimiento pendiente' }),
    ).toBeInTheDocument();
  });

  it('debe renderizar columnas ordenadas por orderIndex y agrupar tareas por columna', async () => {
    const tasks: TaskResponse[] = [
      makeTask('t1', 'col-1', 0, 'Tarea Inicial 1'),
      makeTask('t2', 'col-1', 1, 'Tarea Inicial 2'),
      makeTask('t3', 'col-2', 0, 'Tarea En Curso'),
    ];

    const boardFetcherMock = vi.fn().mockResolvedValue(sampleBoard);
    const tasksFetcherMock = vi.fn().mockResolvedValue(tasks);

    render(
      <KanbanBoard
        projectId={sampleProjectId}
        boardFetcher={boardFetcherMock}
        tasksFetcher={tasksFetcherMock}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('kanban-board')).toBeInTheDocument();
    });

    // Columnas deben renderizarse ordenadas: col-1 (orderIndex: 0), col-2 (orderIndex: 1), col-3 (orderIndex: 2)
    const columns = screen.getAllByRole('heading', { level: 3 });
    expect(columns[0]).toHaveTextContent('Por Hacer');
    expect(columns[1]).toHaveTextContent('En Progreso');
    expect(columns[2]).toHaveTextContent('Completado');

    // Contadores de tareas
    expect(screen.getByTestId('column-task-count-col-1')).toHaveTextContent('2');
    expect(screen.getByTestId('column-task-count-col-2')).toHaveTextContent('1');
    expect(screen.getByTestId('column-task-count-col-3')).toHaveTextContent('0');

    // Columna 3 está vacía
    expect(screen.getByTestId('empty-column-col-3')).toBeInTheDocument();
  });

  it('debe admitir columnas personalizadas (más o menos de 3 columnas fijas)', async () => {
    const customBoard: BoardResponse = {
      ...sampleBoard,
      columns: [
        {
          id: 'custom-col-1',
          boardId: sampleBoard.id,
          name: 'Backlog Académico',
          orderIndex: 0,
          category: 'TODO',
          createdAt: '2026-10-20T10:00:00.000Z',
          updatedAt: '2026-10-20T10:00:00.000Z',
        },
        {
          id: 'custom-col-2',
          boardId: sampleBoard.id,
          name: 'Desarrollo Activo',
          orderIndex: 1,
          category: 'IN_PROGRESS',
          createdAt: '2026-10-20T10:00:00.000Z',
          updatedAt: '2026-10-20T10:00:00.000Z',
        },
        {
          id: 'custom-col-3',
          boardId: sampleBoard.id,
          name: 'Control de Calidad QA',
          orderIndex: 2,
          category: 'IN_REVIEW',
          createdAt: '2026-10-20T10:00:00.000Z',
          updatedAt: '2026-10-20T10:00:00.000Z',
        },
        {
          id: 'custom-col-4',
          boardId: sampleBoard.id,
          name: 'Entregado al Docente',
          orderIndex: 3,
          category: 'DONE',
          createdAt: '2026-10-20T10:00:00.000Z',
          updatedAt: '2026-10-20T10:00:00.000Z',
        },
      ],
    };

    render(
      <KanbanBoard
        projectId={sampleProjectId}
        boardFetcher={vi.fn().mockResolvedValue(customBoard)}
        tasksFetcher={vi.fn().mockResolvedValue([])}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Backlog Académico')).toBeInTheDocument();
      expect(screen.getByText('Desarrollo Activo')).toBeInTheDocument();
      expect(screen.getByText('Control de Calidad QA')).toBeInTheDocument();
      expect(screen.getByText('Entregado al Docente')).toBeInTheDocument();
    });
  });

  it('debe mostrar estado de tablero vacío si no existen columnas configuradas', async () => {
    const emptyBoard: BoardResponse = {
      ...sampleBoard,
      columns: [],
    };

    render(
      <KanbanBoard
        projectId={sampleProjectId}
        boardFetcher={vi.fn().mockResolvedValue(emptyBoard)}
        tasksFetcher={vi.fn().mockResolvedValue([])}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('kanban-board-empty')).toBeInTheDocument();
      expect(screen.getByText('Tablero sin columnas configuradas')).toBeInTheDocument();
    });
  });

  it('debe cargar varias páginas y reflejar todas las tarjetas y contadores sin omisión', async () => {
    const paginationBoard: BoardResponse = {
      ...sampleBoard,
      columns: [
        { ...sampleBoard.columns[0]!, id: '44444444-4444-4444-8444-444444444441' },
        { ...sampleBoard.columns[1]!, id: '44444444-4444-4444-8444-444444444442' },
        { ...sampleBoard.columns[2]!, id: '44444444-4444-4444-8444-444444444443' },
      ],
    };
    const pageOneTasks = Array.from({ length: 100 }, (_, index) =>
      makeTask(
        `33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}`,
        '44444444-4444-4444-8444-444444444441',
        index,
        `Tarea de la página 1 #${index + 1}`,
      ),
    );
    const pageTwoTasks = [
      makeTask(
        '33333333-3333-4333-8333-000000000101',
        '44444444-4444-4444-8444-444444444441',
        100,
        'Tarea de la página 2',
      ),
    ];

    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: pageOneTasks,
          totalItems: 101,
          page: 1,
          limit: 100,
          totalPages: 2,
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: pageTwoTasks,
          totalItems: 101,
          page: 2,
          limit: 100,
          totalPages: 2,
        }),
      } as Response);
    vi.stubGlobal('fetch', fetchMock);

    render(
      <KanbanBoard
        projectId={sampleProjectId}
        boardFetcher={vi.fn().mockResolvedValue(paginationBoard)}
        tasksFetcher={(projectId, options) => getAllProjectTasks(projectId, undefined, options)}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('kanban-board')).toBeInTheDocument();
    });

    expect(
      screen.getByTestId('column-task-count-44444444-4444-4444-8444-444444444441'),
    ).toHaveTextContent('101');
    expect(
      screen.getByTestId('column-task-count-44444444-4444-4444-8444-444444444442'),
    ).toHaveTextContent('0');
    expect(screen.getByText('Tarea de la página 1 #1')).toBeInTheDocument();
    expect(screen.getByText('Tarea de la página 1 #100')).toBeInTheDocument();
    expect(screen.getByText('Tarea de la página 2')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/api/projects/${sampleProjectId}/tasks?page=1&limit=100`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/projects/${sampleProjectId}/tasks?page=2&limit=100`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('debe mostrar estado de error con botón de reintento si la consulta falla', async () => {
    let callCount = 0;
    const boardFetcherMock = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error('Fallo de conexión con el servidor'));
      }
      return Promise.resolve(sampleBoard);
    });

    render(
      <KanbanBoard
        projectId={sampleProjectId}
        boardFetcher={boardFetcherMock}
        tasksFetcher={vi.fn().mockResolvedValue([])}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('kanban-board-error')).toBeInTheDocument();
      expect(screen.getByText('Fallo de conexión con el servidor')).toBeInTheDocument();
    });

    // Probar reintento
    const retryBtn = screen.getByTestId('kanban-retry-btn');
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByTestId('kanban-board')).toBeInTheDocument();
    });
    expect(callCount).toBe(2);
  });

  it('debe descartar respuestas tardías al cambiar projectId para evitar mostrar datos de otro proyecto', async () => {
    let resolveProject1Board: (b: BoardResponse) => void = () => {};
    let resolveProject1Tasks: (t: TaskResponse[]) => void = () => {};

    const project1BoardPromise = new Promise<BoardResponse>((res) => {
      resolveProject1Board = res;
    });
    const project1TasksPromise = new Promise<TaskResponse[]>((res) => {
      resolveProject1Tasks = res;
    });

    const project2Board: BoardResponse = {
      ...sampleBoard,
      id: 'board-proj-2',
      projectId: 'project-2-id',
      columns: [
        {
          id: 'col-proj2',
          boardId: 'board-proj-2',
          name: 'Columna Proyecto 2',
          orderIndex: 0,
          category: 'TODO',
          createdAt: '2026-10-20T10:00:00.000Z',
          updatedAt: '2026-10-20T10:00:00.000Z',
        },
      ],
    };
    const project2Tasks: TaskResponse[] = [
      makeTask('task-p2', 'col-proj2', 0, 'Tarea Exclusiva Proyecto 2'),
    ];

    const boardFetcherMock = vi.fn().mockImplementation((projId: string) => {
      if (projId === 'project-1-id') return project1BoardPromise;
      return Promise.resolve(project2Board);
    });

    const tasksFetcherMock = vi.fn().mockImplementation((projId: string) => {
      if (projId === 'project-1-id') return project1TasksPromise;
      return Promise.resolve(project2Tasks);
    });

    const { rerender } = render(
      <KanbanBoard
        projectId="project-1-id"
        boardFetcher={boardFetcherMock}
        tasksFetcher={tasksFetcherMock}
      />,
    );

    // En este momento Project 1 sigue cargando
    expect(screen.getByTestId('kanban-board-loading')).toBeInTheDocument();

    // El usuario cambia de proyecto a "project-2-id"
    rerender(
      <KanbanBoard
        projectId="project-2-id"
        boardFetcher={boardFetcherMock}
        tasksFetcher={tasksFetcherMock}
      />,
    );

    // Project 2 resuelve de inmediato
    await waitFor(() => {
      expect(screen.getByText('Columna Proyecto 2')).toBeInTheDocument();
      expect(screen.getByText('Tarea Exclusiva Proyecto 2')).toBeInTheDocument();
    });

    // Ahora la respuesta demorada de Project 1 finalmente llega
    await act(async () => {
      resolveProject1Board(sampleBoard);
      resolveProject1Tasks([makeTask('task-p1', 'col-1', 0, 'Tarea Fantasma Proyecto 1')]);
    });
    expect(screen.queryByText('Tarea Fantasma Proyecto 1')).not.toBeInTheDocument();
    expect(screen.getByText('Tarea Exclusiva Proyecto 2')).toBeInTheDocument();
  });

  it('debe crear una tarea con fecha UTC, evitar doble envío e insertarla una sola vez', async () => {
    const creationColumn = {
      ...sampleBoard.columns[0]!,
      id: '44444444-4444-4444-8444-444444444441',
    };
    const creationBoard: BoardResponse = { ...sampleBoard, columns: [creationColumn] };
    const createdTask = makeTask(
      '55555555-5555-4555-8555-555555555555',
      creationColumn.id,
      0,
      'Tarea creada',
    );
    const taskCreator = vi.fn().mockResolvedValue(createdTask);

    render(
      <KanbanBoard
        projectId={sampleProjectId}
        boardFetcher={vi.fn().mockResolvedValue(creationBoard)}
        tasksFetcher={vi.fn().mockResolvedValue([])}
        taskCreator={taskCreator}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('kanban-board')).toBeInTheDocument());
    const opener = screen.getByRole('button', { name: 'Agregar tarea' });
    fireEvent.click(opener);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Título *'), {
      target: { value: 'Tarea creada' },
    });
    fireEvent.change(screen.getByLabelText('Fecha límite'), {
      target: { value: '2026-10-21' },
    });
    const submit = screen.getByRole('button', { name: 'Crear tarea' });
    fireEvent.click(submit);
    fireEvent.click(submit);

    await waitFor(() => expect(screen.getByText('Tarea creada')).toBeInTheDocument());
    expect(taskCreator).toHaveBeenCalledTimes(1);
    expect(taskCreator).toHaveBeenCalledWith(
      sampleProjectId,
      expect.objectContaining({
        columnId: creationColumn.id,
        dueDate: '2026-10-21T00:00:00.000Z',
      }),
    );
    expect(screen.getByTestId(`column-task-count-${creationColumn.id}`)).toHaveTextContent('1');
    expect(document.activeElement).toBe(opener);
  });

  it('debe ignorar una respuesta POST tardía cuando cambia el proyecto', async () => {
    const project1Column = {
      ...sampleBoard.columns[0]!,
      id: '44444444-4444-4444-8444-444444444441',
    };
    const project2Column = {
      ...sampleBoard.columns[0]!,
      id: '66666666-6666-4666-8666-666666666661',
      name: 'Columna Proyecto 2',
    };
    const pendingCreatedTask = makeTask(
      '77777777-7777-4777-8777-777777777777',
      project1Column.id,
      0,
      'Tarea tardía',
    );
    let resolveCreate: (task: TaskResponse) => void = () => {};
    const taskCreator = vi.fn().mockReturnValue(
      new Promise<TaskResponse>((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const boardFetcher = vi.fn().mockImplementation((id: string) =>
      Promise.resolve({
        ...sampleBoard,
        columns: [id === sampleProjectId ? project1Column : project2Column],
      }),
    );
    const { rerender } = render(
      <KanbanBoard
        projectId={sampleProjectId}
        boardFetcher={boardFetcher}
        tasksFetcher={vi.fn().mockResolvedValue([])}
        taskCreator={taskCreator}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('kanban-board')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Agregar tarea' }));
    fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Tarea tardía' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear tarea' }));

    rerender(
      <KanbanBoard
        projectId="88888888-8888-4888-8888-888888888888"
        boardFetcher={boardFetcher}
        tasksFetcher={vi.fn().mockResolvedValue([])}
        taskCreator={taskCreator}
      />,
    );
    await waitFor(() => expect(screen.getByText('Columna Proyecto 2')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Agregar tarea' }));
      resolveCreate(pendingCreatedTask);
    });
    expect(screen.queryByText('Tarea tardía')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('debe conservar el modal y los campos cuando el POST falla, sin reintentar automáticamente', async () => {
    const creationColumn = {
      ...sampleBoard.columns[0]!,
      id: '44444444-4444-4444-8444-444444444441',
    };
    const taskCreator = vi.fn().mockRejectedValue(new Error('No se pudo guardar la tarea'));

    render(
      <KanbanBoard
        projectId={sampleProjectId}
        boardFetcher={vi.fn().mockResolvedValue({ ...sampleBoard, columns: [creationColumn] })}
        tasksFetcher={vi.fn().mockResolvedValue([])}
        taskCreator={taskCreator}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('kanban-board')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Agregar tarea' }));
    fireEvent.change(screen.getByLabelText('Título *'), {
      target: { value: 'Tarea no confirmada' },
    });
    fireEvent.change(screen.getByLabelText('Descripción'), {
      target: { value: 'Conservar este contenido' },
    });
    fireEvent.change(screen.getByLabelText('Fecha límite'), {
      target: { value: '2026-10-30' },
    });

    const submit = screen.getByRole('button', { name: 'Crear tarea' });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('No se pudo guardar la tarea');
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Comprueba el tablero antes de repetir el envío',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Título *')).toHaveValue('Tarea no confirmada');
    expect(screen.getByLabelText('Descripción')).toHaveValue('Conservar este contenido');
    expect(screen.getByLabelText('Fecha límite')).toHaveValue('2026-10-30');
    expect(submit).not.toBeDisabled();
    expect(taskCreator).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(`column-task-count-${creationColumn.id}`)).toHaveTextContent('0');
    expect(screen.queryByText('Tarea no confirmada')).not.toBeInTheDocument();
  });

  it('debe conservar una sola tarjeta y contador si el POST devuelve un id ya cargado', async () => {
    const creationColumn = {
      ...sampleBoard.columns[0]!,
      id: '44444444-4444-4444-8444-444444444441',
    };
    const existingTask = makeTask(
      '55555555-5555-4555-8555-555555555555',
      creationColumn.id,
      0,
      'Tarea ya existente',
    );
    const taskCreator = vi.fn().mockResolvedValue(existingTask);

    render(
      <KanbanBoard
        projectId={sampleProjectId}
        boardFetcher={vi.fn().mockResolvedValue({ ...sampleBoard, columns: [creationColumn] })}
        tasksFetcher={vi.fn().mockResolvedValue([existingTask])}
        taskCreator={taskCreator}
      />,
    );

    await waitFor(() => expect(screen.getByText('Tarea ya existente')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Agregar tarea' }));
    fireEvent.change(screen.getByLabelText('Título *'), {
      target: { value: 'Solicitud duplicada' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Crear tarea' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(taskCreator).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('Tarea ya existente')).toHaveLength(1);
    expect(screen.getByTestId(`column-task-count-${creationColumn.id}`)).toHaveTextContent('1');
  });

  it('debe reemplazar la tarjeta editada sin duplicarla y conservar el contador', async () => {
    const editColumn = { ...sampleBoard.columns[0]!, id: '44444444-4444-4444-8444-444444444441' };
    const originalTask = {
      ...makeTask('55555555-5555-4555-8555-555555555555', editColumn.id, 0, 'Tarea original'),
      description: 'Descripción original',
    };
    const updatedTask = {
      ...originalTask,
      title: 'Tarea actualizada',
      updatedAt: '2026-10-25T20:00:00.000Z',
    };
    const taskUpdater = vi.fn().mockResolvedValue(updatedTask);

    render(
      <KanbanBoard
        projectId={sampleProjectId}
        boardFetcher={vi.fn().mockResolvedValue({ ...sampleBoard, columns: [editColumn] })}
        tasksFetcher={vi.fn().mockResolvedValue([originalTask])}
        taskUpdater={taskUpdater}
      />,
    );

    await waitFor(() => expect(screen.getByText('Tarea original')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Editar tarea' }));
    fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Tarea actualizada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(taskUpdater).toHaveBeenCalledWith(
      sampleProjectId,
      originalTask.id,
      expect.objectContaining({ title: 'Tarea actualizada' }),
    );
    expect(screen.getAllByText('Tarea actualizada')).toHaveLength(1);
    expect(screen.queryByText('Tarea original')).not.toBeInTheDocument();
    expect(screen.getByTestId(`column-task-count-${editColumn.id}`)).toHaveTextContent('1');
  });

  it('debe conservar la tarjeta y los cambios del formulario si el PATCH falla', async () => {
    const editColumn = { ...sampleBoard.columns[0]!, id: '44444444-4444-4444-8444-444444444441' };
    const originalTask = {
      ...makeTask('55555555-5555-4555-8555-555555555555', editColumn.id, 0, 'Tarea original'),
      description: 'Descripción original',
      dueDate: '2026-11-01T00:00:00.000Z',
    };
    const taskUpdater = vi.fn().mockRejectedValue(new Error('Fallo de red al actualizar'));

    render(
      <KanbanBoard
        projectId={sampleProjectId}
        boardFetcher={vi.fn().mockResolvedValue({ ...sampleBoard, columns: [editColumn] })}
        tasksFetcher={vi.fn().mockResolvedValue([originalTask])}
        taskUpdater={taskUpdater}
      />,
    );

    await waitFor(() => expect(screen.getByText('Tarea original')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Editar tarea' }));
    fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Título pendiente' } });
    fireEvent.change(screen.getByLabelText('Descripción'), {
      target: { value: 'Cambios que deben conservarse' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('La actualización no pudo confirmarse');
    });
    expect(screen.getByRole('alert')).toHaveTextContent('comprueba el tablero antes de repetir');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Título *')).toHaveValue('Título pendiente');
    expect(screen.getByLabelText('Descripción')).toHaveValue('Cambios que deben conservarse');
    expect(screen.getAllByText('Tarea original')).toHaveLength(1);
    expect(screen.getByTestId(`column-task-count-${editColumn.id}`)).toHaveTextContent('1');
  });

  it('debe ignorar una resolución tardía al cambiar de tarea y conservar el modal actual', async () => {
    const editColumn = { ...sampleBoard.columns[0]!, id: '44444444-4444-4444-8444-444444444441' };
    const firstTask = makeTask(
      '55555555-5555-4555-8555-555555555555',
      editColumn.id,
      0,
      'Primera tarea',
    );
    const secondTask = makeTask(
      '66666666-6666-4666-8666-666666666666',
      editColumn.id,
      1,
      'Segunda tarea',
    );
    const updatedFirstTask = { ...firstTask, title: 'Primera tarea actualizada' };
    let resolveFirstUpdate: (task: TaskResponse) => void = () => {};
    const taskUpdater = vi.fn().mockReturnValue(
      new Promise<TaskResponse>((resolve) => {
        resolveFirstUpdate = resolve;
      }),
    );

    render(
      <KanbanBoard
        projectId={sampleProjectId}
        boardFetcher={vi.fn().mockResolvedValue({ ...sampleBoard, columns: [editColumn] })}
        tasksFetcher={vi.fn().mockResolvedValue([firstTask, secondTask])}
        taskUpdater={taskUpdater}
      />,
    );

    await waitFor(() => expect(screen.getByText('Primera tarea')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'Editar tarea' })[0]!);
    fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Primera editada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Editar tarea' })[1]!);
    });
    fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Segunda editada' } });
    await act(async () => {
      resolveFirstUpdate(updatedFirstTask);
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Título *')).toHaveValue('Segunda editada');
    expect(screen.queryByText('Primera tarea actualizada')).not.toBeInTheDocument();
  });

  it('debe ignorar un rechazo tardío al cambiar de proyecto y conservar el modal actual', async () => {
    const firstColumn = { ...sampleBoard.columns[0]!, id: '44444444-4444-4444-8444-444444444441' };
    const secondColumn = {
      ...sampleBoard.columns[0]!,
      id: '77777777-7777-4777-8777-777777777777',
      name: 'Proyecto 2',
    };
    const firstTask = makeTask(
      '55555555-5555-4555-8555-555555555555',
      firstColumn.id,
      0,
      'Tarea proyecto 1',
    );
    const secondTask = makeTask(
      '88888888-8888-4888-8888-888888888888',
      secondColumn.id,
      0,
      'Tarea proyecto 2',
    );
    let rejectFirstUpdate: (error: Error) => void = () => {};
    const taskUpdater = vi.fn().mockReturnValue(
      new Promise<TaskResponse>((_, reject) => {
        rejectFirstUpdate = reject;
      }),
    );
    const boardFetcher = vi.fn().mockImplementation((projectId: string) =>
      Promise.resolve({
        ...sampleBoard,
        projectId,
        columns: [projectId === sampleProjectId ? firstColumn : secondColumn],
      }),
    );
    const tasksFetcher = vi
      .fn()
      .mockImplementation((projectId: string) =>
        Promise.resolve(projectId === sampleProjectId ? [firstTask] : [secondTask]),
      );
    const { rerender } = render(
      <KanbanBoard
        projectId={sampleProjectId}
        boardFetcher={boardFetcher}
        tasksFetcher={tasksFetcher}
        taskUpdater={taskUpdater}
      />,
    );

    await waitFor(() => expect(screen.getByText('Tarea proyecto 1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Editar tarea' }));
    fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Edición tardía' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    rerender(
      <KanbanBoard
        projectId="99999999-9999-4999-8999-999999999999"
        boardFetcher={boardFetcher}
        tasksFetcher={tasksFetcher}
        taskUpdater={taskUpdater}
      />,
    );
    await waitFor(() => expect(screen.getByText('Tarea proyecto 2')).toBeInTheDocument());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Editar tarea' }));
    });
    fireEvent.change(screen.getByLabelText('Título *'), {
      target: { value: 'Edición proyecto 2' },
    });
    await act(async () => {
      rejectFirstUpdate(new Error('Rechazo tardío'));
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Título *')).toHaveValue('Edición proyecto 2');
    expect(screen.queryByText('Rechazo tardío')).not.toBeInTheDocument();
  });
});
