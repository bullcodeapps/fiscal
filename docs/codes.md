# Codes and Sefin rejections

Where to find every code a `DpsInput` needs, and what the common Sefin rejections mean. All sources are the
official NFS-e Nacional documentation at https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica
(state on 2026-11-12). File names change with each release, so search the page for the name prefix.

## Choosing codes

| Field | Official source | How to choose |
| --- | --- | --- |
| `cTribNac` (6 digits) | Anexo B, sheet `LISTA.SERV.NAC.` ([anexo_b-nbs2-lista_servico_nacional-snnfse-v1-01-20260122.xlsx](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/anexo_b-nbs2-lista_servico_nacional-snnfse-v1-01-20260122.xlsx)) | Item(2) + subitem(2) + desdobro(2) of the LC 116 subitem that describes the service, without dots (`170303`). The municipality of incidence must administer the code (E0312). |
| `cNBS` (9 digits) | Same Anexo B, sheet `LISTA.NBS_v2.0` | The NBS 2.0 code of the service, digits only (`1.1401.29.00` is `114012900`). |
| `cIndOp` (6 digits) | Per environment. Produção: Anexo C of NT 004 (`ANEXO_C-INDOP_IBSCBS-SNNFSe`, on the [documentação atual](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual) page). Produção restrita: its own table on the [produção restrita](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita) page ([anexo_c-indop_ibscbs-snnfse-prodrest-v1-01-20260122.xlsx](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita/anexo_c-indop_ibscbs-snnfse-prodrest-v1-01-20260122.xlsx), equal to NT 009 Anexo VII v1.00.00). Newer Anexo VII versions on the RTC page are not in force yet | Use the table of the environment you send to. Codes differ between versions (for example `030102`), so never mix them. Pick the row that matches the supply (LC 214/2025 art. 11). Only rows with `indNFSe = S` are valid (E0901). |
| `CST` + `cClassTrib` | Tabela de Classificação Tributária ([calculadora](https://consumo.tributos.gov.br/servico/calcular-tributos-consumo/calculadora/classificacoes-tributarias)) | Take `cClassTrib` from the table or from Anexo VIII, then the CST paired with it. The row must be valid for NFS-e (E0958). These are the reform (RTC) tables; produção validates against its current annex, so check the documentação atual page too. |
| LC 116 item, NBS, `cIndOp`, `cClassTrib` together | Anexo VIII ([anexo_viii-tabela-correlacao-v01-02-00-20261026.xlsx](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/anexo_viii-tabela-correlacao-v01-02-00-20261026.xlsx)) | A preliminary correlation table of the reform (RTC) documents: the official RTC page says no business rules are based on it yet, and produção follows its current annex. Use it as a starting point to confirm with an accountant, not as an allow-list. Example: 01.01 gives NBS 1.1502.10.00, `cIndOp` 100301, `cClassTrib` 000001. |
| `tpMoeda` (3 digits) | BACEN PTAX currency table ([ptax](https://ptax.bcb.gov.br/ptax_internet/consultarTabelaMoedas.do?method=consultaTabelaMoedas)) | The numeric BACEN code in force on `dCompet`: USD `220`, EUR `978`, GBP `540`. |
| `cPais`, `cPaisResult`, `cPaisPrestacao` | Anexo A, sheet `TAB.PAÍS_ISO2` | ISO 3166-1 alpha-2. A foreign address cannot use `BR`. |
| IBGE codes (`cLocEmi`, `cMun`, `cLocPrestacao`) | Anexo A, sheet `TAB.MUN_IBGE` | 7 digits. In code, `findMunicipalityCode("Itajaí", "SC")` returns `"4208203"`. |

The field rules themselves are in Anexo I (`anexo_i-sefin_adn-dps_nfse-snnfse-v1-01-20260209.xlsx`) and, for
IBS/CBS, Anexo VI (`anexovi-leiautesrn_rtc_ibscbs-v1-04-01-nt009.xlsx`). Confirm tax codes with the
company's accountant: a wrong but valid code is not rejected, it is just a wrong note.

## Before the first note: municipality adhesion

Sefin issues a note only when the issuing municipality (`cLocEmi`) has an active convênio that allows the
national emitters (E0037, E0038, E0039). MEI is exempt. ME/EPP in the Simples Nacional is exempt from E0039
for `dCompet` from 2026-11-01. Check the column `AderenteEmissorNacional` of the adhesion spreadsheet at
https://www.gov.br/nfse/pt-br/municipios/monitoramento-adesoes, or `GET /parametros_municipais/{cMun}/convenio`.
If the municipality uses its own system, issue there instead.

## Common rejections

`SefinError.messages[].code`, with the official message (Portuguese) and the fix.

| Code | Official message | Fix |
| --- | --- | --- |
| E0004 | Conteúdo do identificador informado na DPS difere da concatenação dos campos correspondentes. | Do not edit the XML after `buildDps`. The Id is derived from `cLocEmi`, CNPJ, `serie` and `nDPS`. |
| E0008 | A data e hora de emissão da DPS deve ser anterior ou igual à data do seu processamento (dhProc)... | `dhEmi` is in the future. Pass `new Date()` and check the server clock. |
| E0010 | A série informada na DPS não pertence à faixa definida para o tipo de emissor... | `serie` must be `00001` to `49999`. |
| E0014 | Conjunto de Série, Número, Código do Município Emissor e CNPJ/CPF informado nesta DPS já existe em uma NFS-e gerada... | Reconcile: `findAccessKeyByDpsId(dps.id)`, then `isNfseOfDps` to confirm it is this DPS (else a person decides). Never resend with a new number. |
| E0015 | A data de competência informada na DPS não pode ser posterior à data de emissão (dhEmi) da DPS. | `dCompet` must be on or before the date of `dhEmi`. |
| E0016 | A data de competência deve ser igual ou posterior à data de ativação do convênio do município emissor... | Use a `dCompet` on or after the municipality's activation date. |
| E0037 / E0038 / E0039 | Município emissor sem convênio, com convênio inativo, ou sem os emissores públicos nacionais. | See "Municipality adhesion" above. |
| E0084 | CNPJ do emitente prestador não possui estabelecimento ou domicílio em um município correspondente ao município emissor... | `cLocEmi` must be the municipality of the CNPJ's establishment. |
| E0160 | ...a opção de situação perante o Simples Nacional, do prestador, informada na DPS não está de acordo com o cadastro Simples Nacional. | Set `prest.regTrib.opSimpNac` to the provider's real status in that month. |
| E0310 | O código de tributação nacional informado não existe conforme a lista de serviços nacional... | Use a `cTribNac` from Anexo B. |
| E0312 | O código de tributação nacional informado não está administrado pelo município de incidência do ISSQN... | The municipality does not accept that `cTribNac`. Pick another code or ask the municipality. |
| E0316 | Código da lista NBS informado inexistente tabela de NBS do sistema. | Use a 9-digit NBS 2.0 code. |
| E0322 | É obrigatório informar na DPS um item da NBS se for declarada qualquer informação de IBS/CBS. | Send `serv.cNBS` whenever `IBSCBS` is present. |
| E0239 | O tomador/adquirente de serviço dever ser obrigatoriamente identificado por CNPJ ou CPF e seu endereço nacional informado... | Applies when the IBS/CBS incidence falls on the taker's address in Brazil (depends on `cIndOp`): send `toma` with CNPJ/CPF and a national `end`. |
| E0718 | A assinatura deve ser feita com o certificado digital do emitente da DPS. | Sign with the provider's own certificate (`prest.CNPJ` equal to `certificate.cnpj`). |
| E0859 / E0860 | `cIndOp` informed without IBS/CBS taxation, or missing with it. | Follow the `cClassTrib` row: send `IBSCBS` only when it says IBS/CBS applies. |
| E0901 | cIndOp incorreto para operação de prestação de serviços. | Use a `cIndOp` row with `indNFSe = S`. |
| E0958 | cClassTrib para IBS/CBS incorreto para operação de prestação de serviços. | Use a `cClassTrib` valid for NFS-e. |
| E0223 / E0242 / E0330 / E0590 | Foreign taker and export rules. | `buildDps` checks these before sending. See [errors.md](./errors.md). |
| E0529 | Não é permitido ao emitente da DPS informar que a prestação de serviço se trata de uma exportação de serviço. | The scenario is taxable in Brazil. Do not use `tribISSQN: 3`. |

Codes from events (cancellation), from Anexo II (`anexo_ii-sefin_adn-pedregevt_evt-snnfse-v1-01-20260122.xlsx`):

| Code | Meaning | Fix |
| --- | --- | --- |
| E0822 | The municipality's cancellation deadline passed (default 730 days when the municipality sets none). | Cancellation is no longer possible through e101101. The taxpayer asks for análise fiscal (event e101103) in the national portal. |
| E0823 / E0824 / E0827 | Municipal limits: value, note without an identified taker, note with taxes already paid. | Same as E0822. |
| E0840 | A linked event blocks the cancellation (substitution done, análise fiscal pending). | Look for a cancelling event with `findEvent` (step 11 of [integration.md](./integration.md) checks all of them). If none exists, a person checks the note in the national portal. |

## Rejected DPS: same number or a new one?

Send the corrected DPS with the same `nDPS`, as the reference implementation does. E0014 fires only when a note
"já existe", and a rejected DPS creates no note, so the number is still free. Never give a row a new number:
when a previous send's outcome is unknown, a new number can create a duplicate note.
