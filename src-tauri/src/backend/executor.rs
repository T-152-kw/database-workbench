use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::thread;
use tauri::{AppHandle, Emitter};

pub type ExecutorResult<T> = Result<T, String>;

enum TaskMsg {
    Run(Task),
    Stop,
}

struct Task {
    app_handle: AppHandle,
    context_id: i64,
}

struct Executor {
    sender: mpsc::SyncSender<TaskMsg>,
    thread_count: usize,
    closed: AtomicBool,
}

static EXECUTOR: OnceLock<Executor> = OnceLock::new();

pub fn init(core_threads: u32, max_threads: u32, queue_capacity: u32) -> ExecutorResult<bool> {
    if EXECUTOR.get().is_some() {
        return Ok(true);
    }

    let core = if core_threads == 0 { 1 } else { core_threads } as usize;
    let max = if max_threads == 0 {
        core
    } else {
        max_threads as usize
    };
    let threads = if max < core { core } else { max };
    let capacity = if queue_capacity == 0 {
        500
    } else {
        queue_capacity
    } as usize;

    let (sender, receiver) = mpsc::sync_channel::<TaskMsg>(capacity);
    let receiver = Arc::new(Mutex::new(receiver));
    let executor = Executor {
        sender,
        thread_count: threads,
        closed: AtomicBool::new(false),
    };

    for idx in 0..threads {
        let rx = Arc::clone(&receiver);
        thread::Builder::new()
            .name(format!("dbw-exec-{}", idx + 1))
            .spawn(move || worker_loop(rx))
            .map_err(|e| format!("Failed to spawn worker: {e}"))?;
    }

    let _ = EXECUTOR.set(executor);
    Ok(true)
}

pub fn submit(app_handle: AppHandle, context_id: i64) -> ExecutorResult<bool> {
    let executor = EXECUTOR
        .get()
        .ok_or_else(|| "Executor not initialized".to_string())?;

    if executor.closed.load(Ordering::SeqCst) {
        return Err("Executor is closed".to_string());
    }

    let task = Task {
        app_handle,
        context_id,
    };

    match executor.sender.try_send(TaskMsg::Run(task)) {
        Ok(()) => Ok(true),
        Err(mpsc::TrySendError::Full(_)) => Err("Executor queue full".to_string()),
        Err(mpsc::TrySendError::Disconnected(_)) => Err("Executor unavailable".to_string()),
    }
}

pub fn shutdown() -> ExecutorResult<bool> {
    let executor = EXECUTOR
        .get()
        .ok_or_else(|| "Executor not initialized".to_string())?;
    executor.closed.store(true, Ordering::SeqCst);
    for _ in 0..executor.thread_count {
        let _ = executor.sender.send(TaskMsg::Stop);
    }
    Ok(true)
}

fn worker_loop(receiver: Arc<Mutex<mpsc::Receiver<TaskMsg>>>) {
    loop {
        let msg = {
            let guard = receiver.lock();
            let Ok(guard) = guard else { break };
            guard.recv()
        };
        match msg {
            Ok(TaskMsg::Run(task)) => {
                let _ = task.app_handle.emit("executor_task", task.context_id);
            }
            Ok(TaskMsg::Stop) => break,
            Err(_) => break,
        }
    }
}
