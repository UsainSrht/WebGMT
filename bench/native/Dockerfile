# Native GMT 6.6.0 for the benchmark: the same release and the same GSHHG coastlines as the WebAssembly build
# (docker/Dockerfile.wasm), built for Linux with OpenMP off so it runs on one core like the browser build.
# Only used by `npm run bench:native`; nothing here is part of the website.
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake ninja-build curl ca-certificates xz-utils pkg-config \
      libnetcdf-dev libgdal-dev libpcre2-dev libfftw3-dev libcurl4-openssl-dev liblapack-dev \
      ghostscript time gawk \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN curl -fsSL https://github.com/GenericMappingTools/gshhg-gmt/releases/download/2.3.7/gshhg-gmt-2.3.7.tar.gz | tar xz \
 && curl -fsSL https://github.com/GenericMappingTools/dcw-gmt/releases/download/2.2.0/dcw-gmt-2.2.0.tar.gz | tar xz \
 && curl -fsSL https://github.com/GenericMappingTools/gmt/releases/download/6.6.0/gmt-6.6.0-src.tar.xz | tar xJ

RUN cd gmt-6.6.0 && cmake -B build -G Ninja \
      -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/gmt \
      -DGSHHG_ROOT=/src/gshhg-gmt-2.3.7 -DDCW_ROOT=/src/dcw-gmt-2.2.0 -DCOPY_GSHHG=ON -DCOPY_DCW=ON \
      -DGMT_ENABLE_OPENMP=OFF -DBUILD_SUPPLEMENTS=OFF -DGMT_USE_OPTIONAL_LIBS=OFF \
 && cmake --build build && cmake --install build

ENV PATH=/opt/gmt/bin:$PATH
RUN gmt --version && ls /opt/gmt/share/coast /opt/gmt/share/dcw | head -3 && echo native build OK
COPY run.sh /bench/run.sh
RUN chmod +x /bench/run.sh
ENTRYPOINT ["/bench/run.sh"]
