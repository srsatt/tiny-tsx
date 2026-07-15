use std::{
    sync::{Arc, Barrier, Mutex, mpsc},
    time::Duration,
};

use super::{ApplicationPool, CallError, PostError, ReplyError};

#[test]
fn preserves_order_and_isolated_worker_state() {
    let pool = ApplicationPool::new(
        2,
        4,
        4,
        |_| 0_usize,
        |count, value| {
            *count += 1;
            (value, *count)
        },
    )
    .expect("create application pool");
    let first = pool.spawn();
    let second = pool.spawn();
    let first_a = first.try_post("a").expect("post first a");
    let first_b = first.try_post("b").expect("post first b");
    let second_a = second.try_post("a").expect("post second a");

    assert_eq!(first_a.receive(), Ok(("a", 1)));
    assert_eq!(first_b.receive(), Ok(("b", 2)));
    assert_eq!(second_a.receive(), Ok(("a", 1)));
    assert_ne!(first.id(), second.id());
    pool.join();
}

#[test]
fn distinct_logical_workers_execute_on_the_native_pool_in_parallel() {
    let barrier = Arc::new(Barrier::new(3));
    let pool = ApplicationPool::new(2, 2, 1, |_| (), {
        let barrier = Arc::clone(&barrier);
        move |_, value| {
            barrier.wait();
            value
        }
    })
    .expect("create application pool");
    let first = pool.spawn();
    let second = pool.spawn();
    let first_reply = first.try_post(1).expect("post first");
    let second_reply = second.try_post(2).expect("post second");
    barrier.wait();

    assert_eq!(first_reply.receive(), Ok(1));
    assert_eq!(second_reply.receive(), Ok(2));
    pool.join();
}

#[test]
fn termination_cancels_queued_messages_after_active_work() {
    let (started_tx, started_rx) = mpsc::channel();
    let gate = Arc::new((Mutex::new(false), std::sync::Condvar::new()));
    let pool = ApplicationPool::new(1, 1, 2, |_| (), {
        let gate = Arc::clone(&gate);
        move |_, value| {
            started_tx.send(()).expect("report active message");
            let (open, changed) = &*gate;
            let mut open = open.lock().expect("lock gate");
            while !*open {
                open = changed.wait(open).expect("wait gate");
            }
            value
        }
    })
    .expect("create application pool");
    let worker = pool.spawn();
    let active = worker.try_post(1).expect("post active");
    started_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("active message started");
    let queued = worker.try_post(2).expect("post queued");
    worker.terminate();
    assert_eq!(queued.receive(), Err(ReplyError::Terminated));
    assert_eq!(
        worker.call(3),
        Err(CallError::Post(PostError::Terminated(3)))
    );
    let (open, changed) = &*gate;
    *open.lock().expect("lock gate") = true;
    changed.notify_all();
    assert_eq!(active.receive(), Ok(1));
    pool.join();
}

#[test]
fn panic_is_reported_and_later_messages_recover() {
    let pool = ApplicationPool::new(
        1,
        1,
        2,
        |_| (),
        |_, value| if value == 1 { panic!("boom") } else { value },
    )
    .expect("create application pool");
    let worker = pool.spawn();

    assert_eq!(worker.call(1), Err(CallError::Reply(ReplyError::Panicked)));
    assert_eq!(worker.call(2), Ok(2));
    pool.join();
}

#[test]
fn rejected_post_returns_message_ownership() {
    let barrier = Arc::new(Barrier::new(2));
    let (started_tx, started_rx) = mpsc::channel();
    let pool = ApplicationPool::new(1, 1, 1, |_| (), {
        let barrier = Arc::clone(&barrier);
        move |_, value| {
            if value == "active" {
                started_tx.send(()).expect("report active worker");
                barrier.wait();
            }
            value
        }
    })
    .expect("create application pool");
    let active = pool.spawn();
    let waiting = pool.spawn();
    let rejected = pool.spawn();
    let active_reply = active
        .try_post(String::from("active"))
        .expect("post active");
    started_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("active worker started");
    let waiting_reply = waiting
        .try_post(String::from("waiting"))
        .expect("post waiting");
    match rejected.try_post(String::from("owned")) {
        Err(PostError::PoolFull(message)) => assert_eq!(message, "owned"),
        Err(error) => panic!("unexpected rejection: {error:?}"),
        Ok(_) => panic!("over-capacity post was accepted"),
    }
    barrier.wait();
    assert_eq!(active_reply.receive(), Ok(String::from("active")));
    assert_eq!(waiting_reply.receive(), Ok(String::from("waiting")));
    pool.join();
}
