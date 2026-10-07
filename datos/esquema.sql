-- Biblioteca del Cerro · esquema de la nube (PostgreSQL / Supabase)
--
-- Esto se pega entero en Supabase → SQL Editor → Run. Crea las tablas, los
-- permisos y los respaldos. Se puede volver a ejecutar sin romper nada.
--
-- Tiene los mismos campos que datos/biblioteca.json, así que la escena y el
-- editor no cambian: solo cambia de dónde salen los datos (electron/nube.js).
--
--   altitud { min, max }           →  altitud_min, altitud_max
--   secciones, notas, portada      →  columnas jsonb con la misma forma
--   imagenes [{ ruta, en }]        →  columna jsonb (una sola tabla: el libro
--                                     se guarda y se lee de una vez)
--   disposicion { niveles, modo }  →  niveles, modo

-- ---------------------------------------------------------------- las tablas

create table if not exists biblioteca (
  id      integer primary key default 1 check (id = 1), -- una sola fila
  nombre  text not null default 'Biblioteca del Cerro',
  lema    text not null default '',
  -- Disposición de la pared de estantes: cuántos se pueden apilar en una columna
  -- y por dónde se van llenando los huecos libres.
  niveles integer not null default 2 check (niveles between 1 and 3),
  modo    text not null default 'columnas' check (modo in ('columnas', 'filas')),
  -- Sube de uno en uno con cada cambio, en cualquier tabla. Los programas
  -- preguntan por este número cada pocos segundos: si cambió, recargan. Es la
  -- consulta más barata que hay, un entero.
  version bigint not null default 1
);

insert into biblioteca (id) values (1) on conflict (id) do nothing;

create table if not exists categorias (
  id          text primary key,                        -- "arboles-nativos"
  nombre      text not null check (char_length(nombre) between 1 and 40),
  codigo      text not null default '' check (codigo ~ '^[A-Z]{0,3}$'),
  descripcion text not null default '',
  orden       integer,                                 -- null = orden alfabético
  -- Sitio elegido en la pared (los dos nulos = se acomoda solo). No hace falta
  -- que sean únicos: si dos piden el mismo hueco, el bibliotecario automático
  -- corre al segundo (ver src/datos/organizar.js).
  columna     integer check (columna >= 0),
  nivel       integer check (nivel >= 0),
  check ((columna is null) = (nivel is null))
);

create table if not exists libros (
  id          text primary key,                        -- "ceibo"
  categoria   text not null references categorias (id) on update cascade on delete restrict,
  titulo      text not null check (char_length(titulo) between 1 and 60),
  especie     text not null default '',
  autor       text not null default '',
  familia     text not null default '',
  ficha       text not null default '' check (char_length(ficha) <= 140),
  signatura   text not null default '',
  altitud_min integer,
  altitud_max integer,
  portada     jsonb not null default '{}'::jsonb,      -- { "tipo": "cuero", "color": "#5c1e1a" }
  lamina      text not null default '',                -- dibujo incluido (opcional)
  secciones   jsonb not null default '[]'::jsonb,      -- [{ "titulo": "…", "texto": "…" }]
  notas       jsonb not null default '[]'::jsonb,      -- ["…", "…"]
  imagenes    jsonb not null default '[]'::jsonb,      -- [{ "ruta": "…", "en": "portadilla" }]
  orden       integer,                                 -- null = orden alfabético
  muestra     boolean not null default false,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  check ((altitud_min is null) = (altitud_max is null)),
  check (altitud_min is null or (altitud_min >= 0 and altitud_max <= 7000 and altitud_min < altitud_max))
);

create index if not exists libros_por_categoria on libros (categoria);

-- Respaldos: una copia entera de la biblioteca después de cada cambio. Como
-- cualquiera puede editar, cualquiera puede equivocarse; esto permite volver
-- atrás. Se guardan las últimas 200 y nadie puede borrarlas desde la app (ver
-- los permisos más abajo).
create table if not exists respaldos (
  id     bigserial primary key,
  cuando timestamptz not null default now(),
  quien  text not null default '',                     -- de dónde vino el cambio
  datos  jsonb not null                                -- la biblioteca entera
);

create index if not exists respaldos_por_fecha on respaldos (cuando desc);

-- ------------------------------------------------- la versión y los respaldos

-- La biblioteca entera, con la misma forma que datos/biblioteca.json.
create or replace function biblioteca_entera() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'formato', 1,
    'biblioteca', (select jsonb_build_object('nombre', nombre, 'lema', lema,
                            'disposicion', jsonb_build_object('niveles', niveles, 'modo', modo))
                   from biblioteca where id = 1),
    'categorias', coalesce((select jsonb_agg(to_jsonb(c) - 'id' || jsonb_build_object('id', c.id) order by c.orden nulls last, c.nombre)
                            from categorias c), '[]'::jsonb),
    'libros', coalesce((select jsonb_agg(to_jsonb(l) order by l.orden nulls last, l.titulo) from libros l), '[]'::jsonb)
  );
$$;

-- Después de cualquier cambio: sube la versión y guarda una copia. Es por
-- sentencia, no por fila: guardar un libro con diez láminas deja un respaldo.
create or replace function anotar_cambio() returns trigger language plpgsql as $$
begin
  update biblioteca set version = version + 1 where id = 1;
  insert into respaldos (quien, datos) values (tg_table_name, biblioteca_entera());
  delete from respaldos where id <= (
    select max(id) - 200 from respaldos
  );
  return null;
end;
$$;

drop trigger if exists cambio_categorias on categorias;
create trigger cambio_categorias after insert or update or delete on categorias
  for each statement execute function anotar_cambio();

drop trigger if exists cambio_libros on libros;
create trigger cambio_libros after insert or update or delete on libros
  for each statement execute function anotar_cambio();

-- En `biblioteca` el disparador miraría su propia actualización de `version`:
-- solo se anota cuando cambia el nombre, el lema o la disposición.
create or replace function anotar_biblioteca() returns trigger language plpgsql as $$
begin
  if new.nombre is distinct from old.nombre
     or new.lema is distinct from old.lema
     or new.niveles is distinct from old.niveles
     or new.modo is distinct from old.modo then
    update biblioteca set version = version + 1 where id = 1;
    insert into respaldos (quien, datos) values ('biblioteca', biblioteca_entera());
  end if;
  return null;
end;
$$;

drop trigger if exists cambio_biblioteca on biblioteca;
create trigger cambio_biblioteca after update on biblioteca
  for each row execute function anotar_biblioteca();

-- Volver atrás. Si alguien borra media biblioteca o se equivoca en grande, esto
-- la deja como estaba en el respaldo que se elija:
--
--   select id, cuando, quien from respaldos order by id desc limit 20;
--   select restaurar(123);
--
-- Se ejecuta desde el panel de Supabase, no desde la app: deshacer el trabajo de
-- otro no es algo que deba poder hacerse con un clic desde cualquier copia.
create or replace function restaurar(respaldo bigint) returns void language plpgsql as $$
declare d jsonb;
begin
  select datos into d from respaldos where id = respaldo;
  if d is null then raise exception 'No hay ningún respaldo con el número %', respaldo; end if;
  delete from libros;      -- primero los libros: las categorías no se borran con libros dentro
  delete from categorias;
  insert into categorias select * from jsonb_populate_recordset(null::categorias, d -> 'categorias');
  insert into libros     select * from jsonb_populate_recordset(null::libros,     d -> 'libros');
  update biblioteca set
    nombre  = coalesce(d -> 'biblioteca' ->> 'nombre', nombre),
    lema    = coalesce(d -> 'biblioteca' ->> 'lema', lema),
    niveles = coalesce((d -> 'biblioteca' -> 'disposicion' ->> 'niveles')::integer, niveles),
    modo    = coalesce(d -> 'biblioteca' -> 'disposicion' ->> 'modo', modo)
  where id = 1;
end;
$$;

-- ------------------------------------------------------------- quién entra
--
-- La biblioteca es de todos: quien tenga el programa puede leer y editar, y el
-- cambio le llega a los demás. La clave que viaja dentro del programa es la
-- pública (publishable), que es justo para esto.
--
-- Lo único que nadie puede hacer desde la app es tocar los respaldos: se pueden
-- leer y crear, nunca cambiar ni borrar. Si alguien vacía la biblioteca, la
-- copia de antes sigue ahí.

alter table biblioteca enable row level security;
alter table categorias enable row level security;
alter table libros     enable row level security;
alter table respaldos  enable row level security;

drop policy if exists "leer biblioteca"     on biblioteca;
drop policy if exists "escribir biblioteca" on biblioteca;
create policy "leer biblioteca"     on biblioteca for select using (true);
create policy "escribir biblioteca" on biblioteca for update using (true) with check (true);

drop policy if exists "leer categorias"     on categorias;
drop policy if exists "escribir categorias" on categorias;
create policy "leer categorias"     on categorias for select using (true);
create policy "escribir categorias" on categorias for all using (true) with check (true);

drop policy if exists "leer libros"     on libros;
drop policy if exists "escribir libros" on libros;
create policy "leer libros"     on libros for select using (true);
create policy "escribir libros" on libros for all using (true) with check (true);

drop policy if exists "leer respaldos"  on respaldos;
drop policy if exists "crear respaldos" on respaldos;
create policy "leer respaldos"  on respaldos for select using (true);
create policy "crear respaldos" on respaldos for insert with check (true);

-- --------------------------------------------------------------- las láminas
--
-- Las fotos que suba el bibliotecario van a un depósito público llamado
-- `laminas`; en `libros.imagenes[].ruta` se guarda su URL completa. Las láminas
-- que vienen dentro del programa (assets/laminas/…) no se suben: ya las tiene
-- todo el mundo.

insert into storage.buckets (id, name, public)
values ('laminas', 'laminas', true)
on conflict (id) do update set public = true;

drop policy if exists "ver laminas"    on storage.objects;
drop policy if exists "subir laminas"  on storage.objects;
create policy "ver laminas"   on storage.objects for select
  using (bucket_id = 'laminas');
create policy "subir laminas" on storage.objects for insert
  with check (bucket_id = 'laminas');
