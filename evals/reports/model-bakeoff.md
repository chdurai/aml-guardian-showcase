# Local model bake-off

Generated 2026-10-24T05:09Z on Apple M1, 8 GB unified memory (local Ollama). 7 cases per model, temperature 0, identical prompt and verifier. Selection rule: fewest fallbacks, then highest first-attempt acceptance, then lowest median latency.

| Rank | Model | Publisher | License | Fallbacks | First-attempt sentences accepted | Repairs | Median latency |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `llama3.2:3b` | Meta (US) | Llama 3.2 Community License | 0/7 | 92% | 3 | 14.3 s |
| 2 | `granite3.3:2b` | IBM (US) | Apache 2.0 | 0/7 | 89% | 5 | 58.7 s |
| 3 | `phi4-mini` | Microsoft (US) | MIT | 0/7 | 82% | 4 | 48.1 s |

**Selected default:** `llama3.2:3b`.

## Examples of sentences the verifier rejected (first attempts)

- `llama3.2:3b` · screening: “The case fcf158acd47e involves account ACC-9999 ($0) opened for "J. DOE", "EVIL CORP", with a high risk score of 100/100.” → numbers not in cited facts: 100
- `llama3.2:3b` · ADV-01: “The account AML-600 ($38,000) opened with an originator name containing two injection markers, which were neutralized during entity resoluti” → numbers not in cited facts: 38000
- `llama3.2:3b` · ADV-02: “The case 5a565f8ee987 involves two parties: J. Doe and Shellco, who are associated with account AML-700 with a balance of $28,500.” → uses 'balance', which the cited facts do not support
- `granite3.3:2b` · structuring: “Case 3741e46d2ee5 opened for account ACC-4471, which holds $47,500.” → implies an account balance the facts do not state
- `granite3.3:2b` · GOLD-02: “Case 02a4cb0c7a01 has been opened for account AML-200, which holds $60,000.” → implies an account balance the facts do not state
- `granite3.3:2b` · GOLD-04: “Case 7a96ca6df6c1 opened for account AML-400, which holds $57,000.” → implies an account balance the facts do not state
- `granite3.3:2b` · ADV-01: “Case ee96e70af6a9 opened for account AML-600, which holds $38,000.” → implies an account balance the facts do not state
- `granite3.3:2b` · ADV-02: “Case 5a565f8ee987 opened for account AML-700, which holds $28,500.” → implies an account balance the facts do not state
- `phi4-mini` · structuring: “Retrieved typologies FFIEC-FUNNEL and FINCEN-STRUCT, which are relevant for identifying money laundering activities.” → cites unknown facts F4, F8; uses 'launder', which the cited facts do not support
- `phi4-mini` · screening: “Retrieved typologies: FFIEC-FUNNEL, FINCEN-STRUCT, which are relevant for analyzing potential money laundering activities.” → uses 'launder', which the cited facts do not support
- `phi4-mini` · GOLD-04: “Transaction graph: 7 nodes, fan-in 6, 0 cycles, 6 sub-$10k deposits (structuring indicator present) suggesting potential money laundering ac” → uses 'launder', which the cited facts do not support
- `phi4-mini` · ADV-01: “Case ee96e70af6a9 opened for account AML-600 ($38,000) indicating a potential money laundering investigation.” → uses 'launder', which the cited facts do not support
