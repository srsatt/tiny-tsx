use std::{
    sync::{Arc, Barrier, Mutex, mpsc},
    time::Duration,
};

use super::{ApplicationPool, CallError, PostError, ReplyError, RestartPolicy};

#[test]
fn ten_thousand_idle_actors_do_not_preallocate_mailbox_slots_or_threads() {
    let pool = ApplicationPool::new(2, 64, 64, |_| (), |_, value: usize| value)
        .expect("create application pool");
    let actors = (0..10_000).map(|_| pool.spawn()).collect::<Vec<_>>();

    assert_eq!(pool.executor_count(), 2);
    assert_eq!(actors.first().map(|actor| actor.id()), Some(0));
    assert_eq!(actors.last().map(|actor| actor.id()), Some(9_999));
    assert!(actors.iter().all(|actor| {
        let mailbox = super::lock(&actor.control.mailbox);
        mailbox.messages.capacity() == 0 && mailbox.capacity == 64
    }));

    drop(actors);
    pool.join();
}

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
fn a_hot_mailbox_yields_to_another_actor_after_one_quantum() {
    let (started_tx, started_rx) = mpsc::channel();
    let (executed_tx, executed_rx) = mpsc::channel();
    let gate = Arc::new((Mutex::new(false), std::sync::Condvar::new()));
    let pool = ApplicationPool::new(1, 4, 64, |_| (), {
        let gate = Arc::clone(&gate);
        move |_, message: (&'static str, usize)| {
            if message == ("hot", 0) {
                started_tx.send(()).expect("report hot actor start");
                let (open, changed) = &*gate;
                let mut open = open.lock().expect("lock fairness gate");
                while !*open {
                    open = changed.wait(open).expect("wait for fairness gate");
                }
            }
            executed_tx.send(message).expect("record execution order");
            message
        }
    })
    .expect("create application pool");
    let hot = pool.spawn();
    let cold = pool.spawn();
    drop(hot.try_post(("hot", 0)).expect("post active hot message"));
    started_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("hot actor started");
    for index in 1..64 {
        drop(hot.try_post(("hot", index)).expect("fill hot mailbox"));
    }
    drop(cold.try_post(("cold", 0)).expect("post cold message"));
    let (open, changed) = &*gate;
    *open.lock().expect("open fairness gate") = true;
    changed.notify_all();

    let order = (0..65)
        .map(|_| {
            executed_rx
                .recv_timeout(Duration::from_secs(1))
                .expect("receive scheduled message")
        })
        .collect::<Vec<_>>();
    let cold_index = order
        .iter()
        .position(|message| *message == ("cold", 0))
        .expect("cold actor executed");
    assert!(cold_index <= super::MAILBOX_DRAIN_QUANTUM);
    assert!(
        order[cold_index + 1..]
            .iter()
            .any(|message| message.0 == "hot")
    );

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
fn dropping_a_reply_does_not_cancel_an_accepted_message() {
    let pool = ApplicationPool::new(
        1,
        2,
        2,
        |_| 0_i64,
        |state, delta| {
            *state += delta;
            *state
        },
    )
    .expect("create application pool");
    let actor = pool.spawn();

    drop(actor.try_post(2).expect("accept detached message"));
    assert_eq!(actor.call(0), Ok(2));

    pool.join();
}

#[test]
fn cancelling_a_reply_wait_detaches_without_retracting_the_accepted_message() {
    let release = Arc::new(Barrier::new(2));
    let handler_release = Arc::clone(&release);
    let pool = ApplicationPool::new(
        1,
        2,
        2,
        |_| 0_i64,
        move |state, delta| {
            if delta == 2 {
                handler_release.wait();
            }
            *state += delta;
            *state
        },
    )
    .expect("create application pool");
    let actor = pool.spawn();
    let reply = actor.try_post(2).expect("accept cancellable message");
    let polls = std::cell::Cell::new(0);

    assert_eq!(
        reply.receive_with_cancellation(None, Duration::from_millis(5), || {
            polls.set(polls.get() + 1);
            polls.get() == 2
        }),
        Err(ReplyError::Cancelled),
    );
    assert_eq!(polls.get(), 2);

    release.wait();
    assert_eq!(actor.call(0), Ok(2));
    pool.join();
}

#[test]
fn a_timed_out_call_detaches_without_retracting_the_accepted_message() {
    let (started_tx, started_rx) = mpsc::sync_channel(1);
    let release = Arc::new(Barrier::new(2));
    let handler_release = Arc::clone(&release);
    let pool = ApplicationPool::new(
        1,
        8,
        8,
        |_| 0,
        move |state, message| {
            if message == 1 {
                started_tx.send(()).expect("report blocking message");
                handler_release.wait();
            }
            *state += message;
            *state
        },
    )
    .expect("create pool");
    let actor = pool.spawn();
    let active = actor.try_post(1).expect("accept blocking message");
    started_rx
        .recv_timeout(Duration::from_secs(1))
        .expect("blocking message started");

    assert_eq!(
        actor
            .try_post(2)
            .expect("accept timed message")
            .receive_with_cancellation(
                Some(Duration::from_millis(10)),
                Duration::from_millis(2),
                || false,
            ),
        Err(ReplyError::TimedOut),
    );

    release.wait();
    assert_eq!(active.receive(), Ok(1));
    assert_eq!(actor.call(0), Ok(3));
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
fn bounded_restart_reinitializes_state_after_a_panic() {
    let pool = ApplicationPool::new(
        1,
        2,
        2,
        |_| 10_i64,
        |state, value| {
            if value == 0 {
                *state = 99;
                panic!("boom");
            }
            *state += value;
            *state
        },
    )
    .expect("create application pool");
    let other = pool.spawn();
    let worker = pool
        .spawn_with_capacity_and_restart(
            2,
            Some(RestartPolicy {
                max_restarts: 2,
                within: Duration::from_secs(1),
            }),
        )
        .expect("spawn restarting worker");

    assert_eq!(other.call(5), Ok(15));
    assert_eq!(worker.call(1), Ok(11));
    assert_eq!(worker.call(0), Err(CallError::Reply(ReplyError::Panicked)));
    assert_eq!(worker.call(1), Ok(11));
    assert_eq!(other.call(1), Ok(16));
    pool.join();
}

#[test]
fn restart_intensity_terminates_the_logical_worker() {
    let pool = ApplicationPool::new(
        1,
        2,
        2,
        |_| (),
        |_, value| if value == 0 { panic!("boom") } else { value },
    )
    .expect("create application pool");
    let worker = pool
        .spawn_with_capacity_and_restart(
            2,
            Some(RestartPolicy {
                max_restarts: 1,
                within: Duration::from_secs(1),
            }),
        )
        .expect("spawn restarting worker");

    assert_eq!(worker.call(0), Err(CallError::Reply(ReplyError::Panicked)));
    assert_eq!(worker.call(0), Err(CallError::Reply(ReplyError::Panicked)));
    assert_eq!(
        worker.call(1),
        Err(CallError::Post(PostError::Terminated(1)))
    );
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
