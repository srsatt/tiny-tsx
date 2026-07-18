// Derived from the four invalid UTF-8 URLSearchParams rows in
// url/urlencoded-parser.any.js at WPT revision
// 08e168922e0c0d42250335a40e679fa5123489df. Request/Response.formData()
// and the upstream table harness remain outside the bounded native frontend.

test(function() {
    var params = new URLSearchParams('%FE%FF');
    assert_equals(params.get('\uFFFD\uFFFD'), '');
    assert_equals(params.toString(), '%EF%BF%BD%EF%BF%BD=');
}, 'URLSearchParams replaces two invalid leading bytes');

test(function() {
    var params = new URLSearchParams('%FF%FE');
    assert_equals(params.get('\uFFFD\uFFFD'), '');
    assert_equals(params.toString(), '%EF%BF%BD%EF%BF%BD=');
}, 'URLSearchParams replaces two reversed invalid leading bytes');

test(function() {
    var params = new URLSearchParams('%C2');
    assert_equals(params.get('\uFFFD'), '');
    assert_equals(params.toString(), '%EF%BF%BD=');
}, 'URLSearchParams replaces an incomplete UTF-8 sequence');

test(function() {
    var params = new URLSearchParams('%C2x');
    assert_equals(params.get('\uFFFDx'), '');
    assert_equals(params.toString(), '%EF%BF%BDx=');
}, 'URLSearchParams replaces an interrupted UTF-8 sequence');
