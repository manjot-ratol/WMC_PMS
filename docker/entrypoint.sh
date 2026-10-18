#!/bin/sh
# Usage: entrypoint.sh api | worker | mock | mock-mfcentral | migrate
set -e
case "${1:-api}" in
  migrate) exec ./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma ;;
  api)     exec node dist/app/main.js ;;
  worker)  exec node dist/app/worker.js ;;
  mock)    exec node dist/app/trackwizz-mock.js ;;
  mock-mfcentral) exec node dist/app/mfcentral-mock.js ;;
  *)       exec "$@" ;;
esac
