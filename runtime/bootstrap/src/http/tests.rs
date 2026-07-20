use std::{
    ffi::OsString,
    io::ErrorKind,
    net::{IpAddr, Ipv4Addr, TcpListener, TcpStream},
};

use super::{descriptor_ready, listen_host};

#[test]
fn listen_host_defaults_to_loopback_and_accepts_explicit_ip_addresses() {
    assert_eq!(listen_host(None).unwrap(), IpAddr::V4(Ipv4Addr::LOCALHOST));
    assert_eq!(
        listen_host(Some(OsString::from("0.0.0.0"))).unwrap(),
        "0.0.0.0".parse::<IpAddr>().unwrap(),
    );
    assert_eq!(
        listen_host(Some(OsString::from("::"))).unwrap(),
        "::".parse::<IpAddr>().unwrap(),
    );
}

#[test]
fn listen_host_rejects_names_and_empty_values() {
    for value in ["", "localhost", "0.0.0.0:3000"] {
        let error = listen_host(Some(OsString::from(value))).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidInput);
    }
}

#[test]
fn listener_readiness_tracks_pending_connections_without_sleeping() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind listener");
    listener.set_nonblocking(true).expect("set nonblocking");
    assert!(!descriptor_ready(&listener, 0).expect("poll empty listener"));

    let _client = TcpStream::connect(listener.local_addr().expect("listener address"))
        .expect("connect client");

    assert!(descriptor_ready(&listener, 100).expect("poll connected listener"));
}
