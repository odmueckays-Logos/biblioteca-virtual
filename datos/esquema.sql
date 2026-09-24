-- Esquema para cuando la biblioteca use una base de datos PostgreSQL (por
-- ejemplo, Supabase). Tiene los mismos campos que datos/biblioteca.json, así la
-- escena y el editor no cambian: solo se escribe otra fuente de datos
-- (ver src/datos/fuente.js y «Conectar una base de datos» en el README).
--
-- Diferencias con el JSON:
--   altitud { min, max }  →  altitud_min, altitud_max
--   secciones, notas, portada  →  columnas jsonb con la misma forma
--   disposicion { niveles, modo }  →  niveles, modo

create table biblioteca (
  id      integer primary key default 1 check (id = 1), -- una sola fila
  nombre  text not null,
  lema    text not null default '',
  -- Disposición de la pared de estantes: cuántos se pueden apilar en una columna
  -- y por dónde se van llenando los huecos libres.
  niveles integer not null default 2 check (niveles between 1 and 3),
  modo    text not null default 'columnas' check (modo in ('columnas', 'filas'))
);

create table categorias (
  id          text primary key,                        -- "arboles-nativos"
  nombre      text not null check (char_length(nombre) between 1 and 40),
  codigo      text not null unique check (codigo ~ '^[A-Z]{1,3}$'),
  descripcion text not null default '',
  orden       integer,                                 -- null = orden alfabético
  -- Sitio elegido en la pared (los dos nulos = se acomoda solo). No hace falta que
  -- sean únicos: si dos piden el mismo hueco, el bibliotecario automático corre
  -- al segundo (ver src/datos/organizar.js).
  columna     integer check (columna >= 0),
  nivel       integer check (nivel >= 0),
  check ((columna is null) = (nivel is null))
);

create table libros (
  id          text primary key,                        -- "quenua"
  categoria   text not null references categorias (id) on update cascade on delete restrict,
  titulo      text not null check (char_length(titulo) between 1 and 60),
  especie     text not null default '',
  autor       text not null default '',
  familia     text not null default '',
  ficha       text not null default '' check (char_length(ficha) <= 140),
  signatura   text not null default '',
  altitud_min integer,
  altitud_max integer,
  portada     jsonb not null default '{}',             -- { "tipo": "cuero", "color": "#5c1e1a" }
  lamina      text not null default '',                -- dibujo incluido (opcional)
  secciones   jsonb not null default '[]',             -- [{ "titulo": "…", "texto": "…" }]
  notas       jsonb not null default '[]',             -- ["…", "…"]
  orden       integer,                                 -- null = orden alfabético
  muestra     boolean not null default false,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  check ((altitud_min is null) = (altitud_max is null)),
  check (altitud_min is null or (altitud_min >= 0 and altitud_max <= 7000 and altitud_min < altitud_max))
);

create index libros_por_categoria on libros (categoria);
create unique index libros_signatura on libros (signatura) where signatura <> '';

-- Láminas de un libro: la imagen y la página donde la puso el bibliotecario.
create table if not exists laminas (
  id       bigserial primary key,
  libro    text not null references libros (id) on update cascade on delete cascade,
  ruta     text not null,                              -- URL pública de la imagen
  sitio    text not null default 'lamina',             -- portadilla | lamina | seccion:<n> | notas | todas
  orden    integer not null default 0,
  check (sitio in ('portadilla', 'lamina', 'notas', 'todas') or sitio ~ '^seccion:[0-9]+$')
);

create index laminas_por_libro on laminas (libro, orden);
-- Cada página lleva una lámina; «lámina a página completa» admite varias.
create unique index laminas_sitio on laminas (libro, sitio) where sitio <> 'lamina';

-- Seguridad (cuando haya cuentas): cualquiera puede leer; solo los
-- bibliotecarios con sesión iniciada pueden escribir. En Supabase:
--
--   alter table libros enable row level security;
--   create policy "leer" on libros for select using (true);
--   create policy "escribir" on libros for all to authenticated using (true) with check (true);
--   (lo mismo para categorias y biblioteca)
--
-- Las imágenes van en un depósito público (bucket) de almacenamiento; en
-- `laminas.ruta` se guarda su URL.
