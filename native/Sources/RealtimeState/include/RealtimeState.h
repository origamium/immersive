#include <stdint.h>
typedef struct AcousticLease AcousticLease;
AcousticLease *acoustic_lease_create(void);
void acoustic_lease_set(AcousticLease *state, uint64_t deadline);
uint64_t acoustic_lease_get(AcousticLease *state);
void acoustic_lease_destroy(AcousticLease *state);
