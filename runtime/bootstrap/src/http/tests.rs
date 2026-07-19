use std::net::{TcpListener, TcpStream};

use super::descriptor_ready;

#[test]
fn listener_readiness_tracks_pending_connections_without_sleeping() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind listener");
    listener.set_nonblocking(true).expect("set nonblocking");
    assert!(!descriptor_ready(&listener, 0).expect("poll empty listener"));

    let _client = TcpStream::connect(listener.local_addr().expect("listener address"))
        .expect("connect client");

    assert!(descriptor_ready(&listener, 100).expect("poll connected listener"));
}
