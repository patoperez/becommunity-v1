# P6D — Vista previa como cliente

El backoffice permite abrir cualquier estudio en una vista previa interna antes
de publicarlo. La ruta exige una sesión con rol `internal`; una cuenta cliente se
redirige al portal y nunca obtiene acceso anticipado a un borrador.

La vista reutiliza los mismos componentes de portada narrativa, tendencias y
estudio interactivo del portal. Los datos pasan por `loadAuthorizedStudyData` y
`buildStudyDashboard`, por lo que únicamente llegan agregados seguros a los
componentes cliente. La historia se limita explícitamente al tenant del estudio
y sólo incluye estudios publicados, además del estudio concreto que se revisa.

La franja superior identifica la pantalla como vista previa y recuerda que el
cliente todavía no puede verla. El PDF y los recálculos filtrados siguen usando
la sesión interna y las mismas definiciones canónicas; la previsualización no
cambia el estado ni publica contenido.

Verificación: `npm run test:client-preview` comprueba autorización, aislamiento
por tenant, exclusión de otros borradores y reutilización de la frontera
agregada del portal.
