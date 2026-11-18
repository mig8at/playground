# La imagen donde los agentes de Wally compilan y corren Rust (server/rust.go). Trae un conjunto FIJO de bibliotecas ya
# bajadas y compiladas, porque después todo corre SIN RED (`docker run --network none`): lo que escribe un modelo se
# ejecuta acá adentro, viendo sólo la carpeta de su proyecto.
#   docker build -t wally-rust wally/rust      (make wally-rust)
FROM rust:1-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends curl jq ca-certificates && rm -rf /var/lib/apt/lists/*
ENV CARGO_TARGET_DIR=/target
WORKDIR /opt/base
# El proyecto base fija las bibliotecas: sus versiones son las que hay, y quedan en el caché de cargo de la imagen.
RUN cargo init --name base --vcs none . \
 && cargo add axum \
 && cargo add tokio --features full \
 && cargo add serde --features derive \
 && cargo add serde_json \
 && cargo add --dev tower --features util \
 && cargo add --dev http-body-util \
 && cargo build && cargo build --tests
COPY probar-api.sh /usr/local/bin/probar-api
COPY con-api.sh /usr/local/bin/con-api
RUN chmod +x /usr/local/bin/probar-api /usr/local/bin/con-api
ENV CARGO_NET_OFFLINE=true
WORKDIR /work
