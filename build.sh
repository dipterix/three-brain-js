#!/bin/bash

# copy branch of lil-gui with modification
if [[ ! -d "node_modules/lil-gui" ]]
then
  echo "lil-gui is missing"
  if [[ ! -d "lil-gui/dist" ]]
  then
    echo "Building home-brewed version of lil-gui"
    rm -rf lil-gui
    git clone https://github.com/dipterix/lil-gui.git
    cd lil-gui
    npm install
    npm run build
    cd ../
  fi
  cp -r lil-gui node_modules/
  rm -rf lil-gui/
fi

# cd inst/js_raws
npx webpack
