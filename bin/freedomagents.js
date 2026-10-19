#!/usr/bin/env node
'use strict'

const { run } = require('../lib/commands.js')

run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code
  })
  .catch((err) => {
    console.error(`错误: ${err.message}`)
    process.exitCode = err.exitCode || 1
  })
