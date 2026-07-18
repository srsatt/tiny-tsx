#include <stddef.h>

#define TINY_URL_SEARCH_PARAMS_CAPACITY 64
#define TINY_URL_COMPONENT_CAPACITY 256
#define TINY_URL_OUTPUT_CAPACITY 16384
#define TINY_UNUSED __attribute__((unused))

typedef struct {
    unsigned char bytes[TINY_URL_COMPONENT_CAPACITY];
    size_t length;
} tiny_owned_string;

typedef struct {
    tiny_owned_string name;
    tiny_owned_string value;
} tiny_url_search_param;

typedef struct {
    tiny_url_search_param pairs[TINY_URL_SEARCH_PARAMS_CAPACITY];
    size_t length;
    int constructed;
    int dirty;
} tiny_url_search_params;

typedef struct {
    const unsigned char *original;
    size_t original_len;
    const unsigned char *prefix;
    size_t prefix_len;
    const unsigned char *fragment;
    size_t fragment_len;
    tiny_url_search_params *params;
    int constructed;
} tiny_url;

static TINY_UNUSED int tiny_bytes_equal(
    const unsigned char *left,
    size_t left_len,
    const unsigned char *right,
    size_t right_len
) {
    if (left_len != right_len) return 0;
    for (size_t index = 0; index < left_len; index++) {
        if (left[index] != right[index]) return 0;
    }
    return 1;
}

static TINY_UNUSED void tiny_copy_bytes(
    unsigned char *output,
    const unsigned char *input,
    size_t length
) {
    for (size_t index = 0; index < length; index++) output[index] = input[index];
}

static TINY_UNUSED int tiny_owned_equal(
    const tiny_owned_string *owned,
    const unsigned char *bytes,
    size_t length
) {
    return tiny_bytes_equal(owned->bytes, owned->length, bytes, length);
}

static TINY_UNUSED int tiny_hex_value(unsigned char byte) {
    if (byte >= '0' && byte <= '9') return byte - '0';
    if (byte >= 'a' && byte <= 'f') return byte - 'a' + 10;
    if (byte >= 'A' && byte <= 'F') return byte - 'A' + 10;
    return -1;
}

static TINY_UNUSED int tiny_form_decode(
    tiny_owned_string *output,
    const unsigned char *input,
    size_t input_len
) {
    unsigned char decoded[TINY_URL_COMPONENT_CAPACITY];
    size_t decoded_len = 0;
    for (size_t index = 0; index < input_len;) {
        unsigned char byte = input[index];
        if (byte == '+') {
            byte = ' ';
            index++;
        } else if (byte == '%' && index + 2 < input_len) {
            int high = tiny_hex_value(input[index + 1]);
            int low = tiny_hex_value(input[index + 2]);
            if (high >= 0 && low >= 0) {
                byte = (unsigned char)((high << 4) | low);
                index += 3;
            } else {
                index++;
            }
        } else {
            index++;
        }
        if (decoded_len == sizeof(decoded)) return 0;
        decoded[decoded_len++] = byte;
    }

    output->length = 0;
    for (size_t index = 0; index < decoded_len;) {
        unsigned char lead = decoded[index];
        if (lead < 0x80) {
            if (output->length == TINY_URL_COMPONENT_CAPACITY) return 0;
            output->bytes[output->length++] = lead;
            index++;
            continue;
        }

        size_t width = 0;
        unsigned char second_min = 0x80;
        unsigned char second_max = 0xBF;
        if (lead >= 0xC2 && lead <= 0xDF) {
            width = 2;
        } else if (lead >= 0xE0 && lead <= 0xEF) {
            width = 3;
            if (lead == 0xE0) second_min = 0xA0;
            if (lead == 0xED) second_max = 0x9F;
        } else if (lead >= 0xF0 && lead <= 0xF4) {
            width = 4;
            if (lead == 0xF0) second_min = 0x90;
            if (lead == 0xF4) second_max = 0x8F;
        }

        size_t consumed = 1;
        if (width > 0 && index + 1 < decoded_len
            && decoded[index + 1] >= second_min
            && decoded[index + 1] <= second_max) {
            consumed = 2;
            while (consumed < width && index + consumed < decoded_len
                && decoded[index + consumed] >= 0x80
                && decoded[index + consumed] <= 0xBF) {
                consumed++;
            }
        }

        if (width > 0 && consumed == width) {
            if (width > TINY_URL_COMPONENT_CAPACITY - output->length) return 0;
            tiny_copy_bytes(output->bytes + output->length, decoded + index, width);
            output->length += width;
            index += width;
            continue;
        }

        static const unsigned char replacement[] = {0xEF, 0xBF, 0xBD};
        if (sizeof(replacement) > TINY_URL_COMPONENT_CAPACITY - output->length) return 0;
        tiny_copy_bytes(output->bytes + output->length, replacement, sizeof(replacement));
        output->length += sizeof(replacement);
        index += consumed;
    }
    return 1;
}

static TINY_UNUSED int tiny_copy_component(
    tiny_owned_string *output,
    const unsigned char *input,
    size_t input_len
) {
    if (input_len > TINY_URL_COMPONENT_CAPACITY) return 0;
    if (input_len > 0) tiny_copy_bytes(output->bytes, input, input_len);
    output->length = input_len;
    return 1;
}

static TINY_UNUSED tiny_url_search_param *tiny_url_search_params_next(
    tiny_url_search_params *params
) {
    if (params->length == TINY_URL_SEARCH_PARAMS_CAPACITY) return NULL;
    return &params->pairs[params->length++];
}

static TINY_UNUSED int tiny_url_search_params_append(
    tiny_url_search_params *params,
    const unsigned char *name,
    size_t name_len,
    const unsigned char *value,
    size_t value_len
) {
    tiny_url_search_param *pair = tiny_url_search_params_next(params);
    if (pair == NULL) return 0;
    if (!tiny_copy_component(&pair->name, name, name_len)
        || !tiny_copy_component(&pair->value, value, value_len)) {
        params->length--;
        return 0;
    }
    params->dirty = 1;
    return 1;
}

static TINY_UNUSED int tiny_url_search_params_append_encoded(
    tiny_url_search_params *params,
    const unsigned char *name,
    size_t name_len,
    const unsigned char *value,
    size_t value_len
) {
    tiny_url_search_param *pair = tiny_url_search_params_next(params);
    if (pair == NULL) return 0;
    if (!tiny_form_decode(&pair->name, name, name_len)
        || !tiny_form_decode(&pair->value, value, value_len)) {
        params->length--;
        return 0;
    }
    return 1;
}

static TINY_UNUSED int tiny_url_search_params_construct(
    tiny_url_search_params *params,
    const unsigned char *input,
    size_t input_len
) {
    params->length = 0;
    params->constructed = 1;
    params->dirty = 0;
    size_t start = input_len > 0 && input[0] == '?' ? 1 : 0;
    while (start <= input_len) {
        size_t end = start;
        while (end < input_len && input[end] != '&') end++;
        if (end > start) {
            size_t equals = start;
            while (equals < end && input[equals] != '=') equals++;
            const unsigned char *value = input + (equals < end ? equals + 1 : end);
            size_t value_len = equals < end ? end - equals - 1 : 0;
            if (!tiny_url_search_params_append_encoded(
                    params, input + start, equals - start, value, value_len)) return 0;
        }
        if (end == input_len) break;
        start = end + 1;
    }
    params->dirty = 0;
    return 1;
}

static TINY_UNUSED void tiny_url_search_params_delete(
    tiny_url_search_params *params,
    const unsigned char *name,
    size_t name_len,
    const unsigned char *value,
    size_t value_len,
    int has_value
) {
    size_t index = 0;
    while (index < params->length) {
        tiny_url_search_param *pair = &params->pairs[index];
        int matches = tiny_owned_equal(&pair->name, name, name_len)
            && (!has_value || tiny_owned_equal(&pair->value, value, value_len));
        if (!matches) {
            index++;
            continue;
        }
        for (size_t next = index + 1; next < params->length; next++) {
            params->pairs[next - 1] = params->pairs[next];
        }
        params->length--;
    }
    params->dirty = 1;
}

static TINY_UNUSED const tiny_url_search_param *tiny_url_search_params_find(
    const tiny_url_search_params *params,
    const unsigned char *name,
    size_t name_len,
    const unsigned char *value,
    size_t value_len,
    int has_value
) {
    for (size_t index = 0; index < params->length; index++) {
        const tiny_url_search_param *pair = &params->pairs[index];
        if (tiny_owned_equal(&pair->name, name, name_len)
            && (!has_value || tiny_owned_equal(&pair->value, value, value_len))) return pair;
    }
    return NULL;
}

static TINY_UNUSED int tiny_output_byte(
    unsigned char *output,
    size_t capacity,
    size_t *length,
    unsigned char byte
) {
    if (*length == capacity) return 0;
    output[(*length)++] = byte;
    return 1;
}

static TINY_UNUSED int tiny_output_bytes(
    unsigned char *output,
    size_t capacity,
    size_t *length,
    const unsigned char *bytes,
    size_t bytes_len
) {
    if (bytes_len > capacity - *length) return 0;
    if (bytes_len > 0) tiny_copy_bytes(output + *length, bytes, bytes_len);
    *length += bytes_len;
    return 1;
}

static TINY_UNUSED int tiny_form_encode_component(
    unsigned char *output,
    size_t capacity,
    size_t *length,
    const tiny_owned_string *component
) {
    static const unsigned char hex[] = "0123456789ABCDEF";
    for (size_t index = 0; index < component->length; index++) {
        unsigned char byte = component->bytes[index];
        int unescaped = (byte >= 'a' && byte <= 'z')
            || (byte >= 'A' && byte <= 'Z')
            || (byte >= '0' && byte <= '9')
            || byte == '*' || byte == '-' || byte == '.' || byte == '_';
        if (unescaped) {
            if (!tiny_output_byte(output, capacity, length, byte)) return 0;
        } else if (byte == ' ') {
            if (!tiny_output_byte(output, capacity, length, '+')) return 0;
        } else if (!tiny_output_byte(output, capacity, length, '%')
            || !tiny_output_byte(output, capacity, length, hex[byte >> 4])
            || !tiny_output_byte(output, capacity, length, hex[byte & 15])) {
            return 0;
        }
    }
    return 1;
}

static TINY_UNUSED int tiny_url_search_params_stringify(
    const tiny_url_search_params *params,
    unsigned char *output,
    size_t capacity,
    size_t *length
) {
    *length = 0;
    for (size_t index = 0; index < params->length; index++) {
        if (index > 0 && !tiny_output_byte(output, capacity, length, '&')) return 0;
        const tiny_url_search_param *pair = &params->pairs[index];
        if (!tiny_form_encode_component(output, capacity, length, &pair->name)
            || !tiny_output_byte(output, capacity, length, '=')
            || !tiny_form_encode_component(output, capacity, length, &pair->value)) {
            return 0;
        }
    }
    return 1;
}

static TINY_UNUSED int tiny_url_construct(
    tiny_url *url,
    tiny_url_search_params *params,
    const unsigned char *input,
    size_t input_len
) {
    size_t fragment = input_len;
    for (size_t index = 0; index < input_len; index++) {
        if (input[index] == '#') {
            fragment = index;
            break;
        }
    }
    size_t query = fragment;
    for (size_t index = 0; index < fragment; index++) {
        if (input[index] == '?') {
            query = index;
            break;
        }
    }
    const unsigned char *query_bytes = input + (query < fragment ? query + 1 : fragment);
    size_t query_len = query < fragment ? fragment - query - 1 : 0;
    if (!tiny_url_search_params_construct(params, query_bytes, query_len)) return 0;
    url->original = input;
    url->original_len = input_len;
    url->prefix = input;
    url->prefix_len = query < fragment ? query : fragment;
    url->fragment = input + fragment;
    url->fragment_len = input_len - fragment;
    url->params = params;
    url->constructed = 1;
    return 1;
}

static TINY_UNUSED int tiny_url_stringify(
    const tiny_url *url,
    unsigned char *output,
    size_t capacity,
    size_t *length
) {
    *length = 0;
    if (!url->params->dirty) {
        return tiny_output_bytes(output, capacity, length, url->original, url->original_len);
    }
    if (!tiny_output_bytes(output, capacity, length, url->prefix, url->prefix_len)) return 0;
    if (url->params->length > 0) {
        if (!tiny_output_byte(output, capacity, length, '?')) return 0;
        size_t query_len = 0;
        unsigned char query[TINY_URL_OUTPUT_CAPACITY];
        if (!tiny_url_search_params_stringify(
                url->params, query, sizeof(query), &query_len)
            || !tiny_output_bytes(output, capacity, length, query, query_len)) {
            return 0;
        }
    }
    return tiny_output_bytes(output, capacity, length, url->fragment, url->fragment_len);
}
