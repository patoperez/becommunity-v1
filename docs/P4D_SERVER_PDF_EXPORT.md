# P4D - Exportacion PDF del informe

## Resultado

Cada tarjeta de estudio ofrece una descarga PDF generada en el servidor. El documento sigue el orden narrativo acordado:

1. resumen ejecutivo;
2. journey;
3. insights por segmento;
4. temas y citas cualitativas confirmadas;
5. metodologia y reglas de lectura.

## Seguridad y consistencia

- `GET /api/studies/[studyId]/report` exige una sesion verificada con `getUser()`.
- El estudio y sus datos se consultan con el cliente Supabase de esa sesion; RLS decide el acceso y un identificador ajeno responde 404.
- El PDF solo consulta `confirmed_qual_observation`; no usa observaciones crudas ni sugerencias pendientes.
- Los filtros activos viajan como parametros `f.<dimension>` y se validan contra el catalogo derivado de los datos RLS-scoped antes de aplicarse.
- Las metricas reutilizan el motor canonico. No existe una segunda implementacion de NPS, CSAT, promedios o journey.
- La supresion se vuelve a evaluar despues de filtrar, tanto para el conjunto completo como para cada indicador, etapa, cruce y tema.
- La respuesta usa `Cache-Control: private, no-store` y `Content-Disposition: attachment`.

## Verificacion

`npm run test:server-pdf` genera un informe sintetico, valida la firma PDF, vuelve a abrirlo y comprueba paginas y metadatos. Para revision visual puede conservarse una muestra con `P4D_SAMPLE_PDF=output/pdf/becommunity-p4d-sample-report.pdf`.
