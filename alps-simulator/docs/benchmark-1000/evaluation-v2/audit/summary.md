# Independent benchmark audit

Status: COMPLETE — 1,400/1,400 independently audited raw trials; 0 audit errors.

Primary outcome: placed volume / supplied volume. All auditable error, cancelled, rejected-box and deadline-miss trials remain in descriptive means and available matched pairs. Missing/corrupt trials are explicit and prevent a complete claim.

Unique SKU sequences and unique seeds are checked within each condition; policies receive identical frozen inputs. Frozen n=100 per condition. The fixed inventory differs between conditions; these are arrival-order experiments.

| Condition | Policy | n / expected | Acceptance % | Fill % | Mean placed | Error / cancelled | Misses | Decision P50 / P95 / P99 / max ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| h1200-n30-s6 | blb | 100/100 | 85.264 | 45.911 | 27.010 | 0 / 0 | 0 | 6.236 / 15.328 / 23.549 / 76.615 |
| h1200-n30-s6 | capacity-compact | 100/100 | 87.765 | 47.258 | 27.590 | 0 / 0 | 0 | 12.464 / 31.492 / 44.367 / 79.671 |
| h1200-n30-s6 | strategy-greedy | 100/100 | 82.086 | 44.200 | 26.410 | 0 / 0 | 0 | 12.375 / 31.992 / 51.568 / 213.540 |
| h1200-n30-s6 | lookahead | 100/100 | 83.985 | 45.222 | 26.780 | 0 / 0 | 0 | 58.715 / 151.753 / 198.451 / 334.621 |
| h1200-n30-s6 | future-hybrid | 100/100 | 91.038 | 49.020 | 28.150 | 0 / 0 | 0 | 172.954 / 645.080 / 821.635 / 1199.489 |
| h1200-n30-s6 | floor-dense | 100/100 | 91.364 | 49.196 | 28.320 | 0 / 0 | 0 | 99.059 / 248.984 / 359.758 / 536.684 |
| h1200-n30-s6 | cluster-layer | 100/100 | 93.552 | 50.374 | 28.730 | 0 / 0 | 0 | 19.850 / 80.227 / 118.780 / 218.764 |
| h1200-n30-s8 | blb | 100/100 | 83.384 | 44.791 | 26.430 | 0 / 0 | 0 | 6.449 / 15.919 / 23.526 / 65.106 |
| h1200-n30-s8 | capacity-compact | 100/100 | 86.085 | 46.242 | 27.160 | 0 / 0 | 0 | 12.450 / 31.643 / 43.546 / 91.300 |
| h1200-n30-s8 | strategy-greedy | 100/100 | 78.355 | 42.090 | 25.400 | 0 / 0 | 0 | 12.249 / 32.953 / 49.642 / 87.785 |
| h1200-n30-s8 | lookahead | 100/100 | 81.478 | 43.767 | 26.160 | 0 / 0 | 0 | 60.217 / 170.803 / 213.509 / 474.745 |
| h1200-n30-s8 | future-hybrid | 100/100 | 90.666 | 48.703 | 27.940 | 0 / 0 | 0 | 182.658 / 812.230 / 1015.446 / 1347.600 |
| h1200-n30-s8 | floor-dense | 100/100 | 88.192 | 47.374 | 27.550 | 0 / 0 | 0 | 99.285 / 248.004 / 343.058 / 752.438 |
| h1200-n30-s8 | cluster-layer | 100/100 | 89.972 | 48.330 | 28.000 | 0 / 0 | 0 | 20.571 / 86.446 / 132.903 / 242.518 |

Paired effects below are floor-dense minus baseline in percentage points. Ordinary t 95% CIs and Bonferroni simultaneous 95% CIs use the predeclared 12-comparison family. The practical superiority threshold is +2 percentage points. Intervals and p-values describe evidence; they do not establish a universal optimum.

| Condition | Baseline | Pairs | Mean effect pp | 95% CI pp | Bonferroni 95% CI pp | Adjusted p |
|---|---|---:|---:|---:|---:|---:|
| h1200-n30-s6 | blb | 100/100 | 6.100 | [4.115, 8.086] | [3.165, 9.036] | 0.000 |
| h1200-n30-s6 | capacity-compact | 100/100 | 3.599 | [1.627, 5.571] | [0.683, 6.515] | 0.006 |
| h1200-n30-s6 | strategy-greedy | 100/100 | 9.278 | [7.274, 11.283] | [6.315, 12.242] | 0.000 |
| h1200-n30-s6 | lookahead | 100/100 | 7.379 | [5.269, 9.489] | [4.260, 10.498] | 0.000 |
| h1200-n30-s6 | future-hybrid | 100/100 | 0.326 | [-1.538, 2.190] | [-2.430, 3.082] | 1.000 |
| h1200-n30-s6 | cluster-layer | 100/100 | -2.188 | [-4.190, -0.185] | [-5.148, 0.773] | 0.391 |
| h1200-n30-s8 | blb | 100/100 | 4.808 | [2.979, 6.638] | [2.103, 7.513] | 0.000 |
| h1200-n30-s8 | capacity-compact | 100/100 | 2.107 | [0.211, 4.003] | [-0.697, 4.910] | 0.358 |
| h1200-n30-s8 | strategy-greedy | 100/100 | 9.837 | [8.009, 11.665] | [7.135, 12.539] | 0.000 |
| h1200-n30-s8 | lookahead | 100/100 | 6.714 | [4.814, 8.615] | [3.906, 9.523] | 0.000 |
| h1200-n30-s8 | future-hybrid | 100/100 | -2.474 | [-4.619, -0.329] | [-5.645, 0.697] | 0.291 |
| h1200-n30-s8 | cluster-layer | 100/100 | -1.780 | [-3.855, 0.296] | [-4.848, 1.288] | 1.000 |

Raw decisionMs pooled per condition/policy, first startup decision included; not per-trial quantile averages. Parallel shared-machine latency is contention-dependent.

Statistics backend: stdlib: CF t quantiles df>=999; beta-CDF quantiles df<999; beta-CDF pvalues.

Audit validates identities, conservation, dimensions/volumes, overlaps/bounds, manifest pairing, decision counts/deadlines, source hashes and freeze signature. It does not independently prove robot reach, gripper collision clearance, material/load models, or real-world transport safety.
