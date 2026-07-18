#include "../../../compiler/src/wpt_url_runtime.c"

static int expect_bytes(
    const tiny_owned_string *actual,
    const unsigned char *expected,
    size_t expected_len
) {
    return tiny_bytes_equal(actual->bytes, actual->length, expected, expected_len);
}

int main(void) {
    tiny_owned_string output = {0};
    static const unsigned char invalid_pair[] = "%FE%FF";
    static const unsigned char replaced_pair[] = {
        0xEF, 0xBF, 0xBD, 0xEF, 0xBF, 0xBD
    };
    if (!tiny_form_decode(&output, invalid_pair, sizeof(invalid_pair) - 1)
        || !expect_bytes(&output, replaced_pair, sizeof(replaced_pair))) return 1;

    static const unsigned char incomplete[] = "%C2x";
    static const unsigned char replaced_incomplete[] = {0xEF, 0xBF, 0xBD, 'x'};
    if (!tiny_form_decode(&output, incomplete, sizeof(incomplete) - 1)
        || !expect_bytes(
            &output, replaced_incomplete, sizeof(replaced_incomplete))) return 2;

    static const unsigned char valid[] = "%E2%8E%84";
    static const unsigned char decoded_valid[] = {0xE2, 0x8E, 0x84};
    if (!tiny_form_decode(&output, valid, sizeof(valid) - 1)
        || !expect_bytes(&output, decoded_valid, sizeof(decoded_valid))) return 3;

    static const unsigned char malformed_percent[] = "%2s";
    if (!tiny_form_decode(
            &output, malformed_percent, sizeof(malformed_percent) - 1)
        || !expect_bytes(
            &output, malformed_percent, sizeof(malformed_percent) - 1)) return 4;

    unsigned char at_limit[85];
    for (size_t index = 0; index < sizeof(at_limit); index++) at_limit[index] = 0xFF;
    if (!tiny_form_decode(&output, at_limit, sizeof(at_limit))
        || output.length != 255) return 5;

    unsigned char over_limit[86];
    for (size_t index = 0; index < sizeof(over_limit); index++) over_limit[index] = 0xFF;
    if (tiny_form_decode(&output, over_limit, sizeof(over_limit))) return 6;

    return 0;
}
