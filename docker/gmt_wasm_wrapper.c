#include <emscripten.h>
#include <stdlib.h>
#include <stdio.h>
#include "gmt.h"

/* Run a single GMT module with string arguments (argv does NOT include the module name).
 * NOTE: with string arguments GMT_Call_Module expects mode == argc (>= 0); GMT_MODULE_OPT is only
 * for pre-parsed GMT_OPTION lists.
 * Each call creates and destroys a session. Modern-mode (`gmt begin ... gmt end`) persists its state
 * in a session directory; the worker sets GMT_SESSION_NAME so consecutive calls share it.
 * `mode` is the GMT_Create_Session mode; verbosity level L is packed as (L << GMT_MSG_BITSHIFT). */
#ifdef __cplusplus
extern "C" {
#endif

EMSCRIPTEN_KEEPALIVE
int execute_gmt_command_ex(const char *module_name, int argc, char **argv, unsigned int mode) {
    /* The process-wide stdin keeps a sticky EOF flag: without this, only the first `echo ... | gmt text` of a
     * script would see its input, because every later call would find stdin already at EOF. */
    clearerr(stdin);
    void *API = GMT_Create_Session("WebGMT", 2U, mode, NULL);
    if (!API) return -1;
    /* mode == 0 means "args is one command string" (GMT_MODULE_CMD), so zero arguments need an empty string */
    int status = (argc == 0) ? GMT_Call_Module(API, module_name, GMT_MODULE_CMD, (void *)"")
                             : GMT_Call_Module(API, module_name, argc, argv);
    GMT_Destroy_Session(API);
    return status;
}

EMSCRIPTEN_KEEPALIVE
int execute_gmt_command(const char *module_name, int argc, char **argv) {
    return execute_gmt_command_ex(module_name, argc, argv, 0U);
}

#ifdef __cplusplus
}
#endif
