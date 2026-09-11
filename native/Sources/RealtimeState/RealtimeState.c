#include "RealtimeState.h"
#include <stdatomic.h>
#include <stdlib.h>
struct AcousticLease { _Atomic uint64_t deadline; };
AcousticLease *acoustic_lease_create(void) { AcousticLease *s=calloc(1,sizeof(*s)); return s; }
void acoustic_lease_set(AcousticLease *s,uint64_t deadline) { atomic_store_explicit(&s->deadline,deadline,memory_order_release); }
uint64_t acoustic_lease_get(AcousticLease *s) { return atomic_load_explicit(&s->deadline,memory_order_acquire); }
void acoustic_lease_destroy(AcousticLease *s) { free(s); }
