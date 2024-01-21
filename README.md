## three-brain-js - Yet a 3D Viewer (HTML, WebGL based) for Brain

<img src="https://github.com/dipterix/threeBrain/blob/master/docs/demo.gif?raw=true" width="100%" />

[![](https://img.shields.io/badge/website-yael.wiki-green)](https://yael.wiki)
[![](https://img.shields.io/badge/DOI-10.1523%2FENEURO.0328--23.2023-blue?link=https%3A%2F%2Fdoi.org%2F10.1523%2FENEURO.0328-23.2023)](https://doi.org/10.1523/ENEURO.0328-23.2023)
![](https://img.shields.io/github/package-json/v/dipterix/three-brain-js/main)
[![](https://img.shields.io/npm/v/%40rave-ieeg%2Fthree-brain)](https://www.npmjs.com/package/@rave-ieeg/three-brain)


This repository contains a JavaScript engine for visualizing 3D brain models via modern web browsers (with [`WebGL2` support](https://get.webgl.org/webgl2/)). The key features include:

* Visualizing surface models (FreeSurfer surface, AFNI/SUMA)
* Overlay T1 MR images as anatomical slices (FreeSurfer `.mgh/mgz`, NIfTI `.nii`)
* Overlay volume data in terms of voxel cubes (NIfTI `.nii`)
* Overlay electrodes as spheres
* Color/Animate electrodes based on their values (continuous, categorical)
* Electrode localization with CT at original resolution (paper in proceeding)
* Group-level electrode mapping (via MNI or SUMA 141 brain)

The source code currently only contains the viewer part. The data configuration files is currently generated by the R package [`threeBrain`](https://github.com/dipterix/threeBrain/). Python package [`threebrainpy`](https://pypi.org/project/threebrainpy/) is also under active development.

Please see "Roadmap" for details.

For developers who wish to incorporate the package into your project:

```sh
npm i @rave-ieeg/three-brain
```

## Roadmap

- [ ] Jul, 2024: Finish documentation; 
- [X] Dec, 2023: Derail R and implement JavaScript code to generate data configurations 
- [X] Oct, 2023: Publish electrode localization paper
- [X] Aug, 2023: Implement drivers to allow other programs to change the viewers via JavaScript events
- [X] Jan, 2023: Create initial commit for the viewer
- [X] Dec, 2022: Isolate the viewer part from R package `threeBrain`

## Citation

Please cite the following paper:

* Wang Z, Magnotti JF, Zhang X, Beauchamp MS. _YAEL: your advanced electrode localizer._ eNeuro 19 October 2023, 10 (10); DOI: 10.1523/ENEURO.0328-23.2023

If you are interested in the bigger framework (RAVE: reproducible analysis and visualization of iEEG), please check:

* Magnotti JF, Wang Z, Beauchamp MS. _RAVE: comprehensive open-source software for reproducible analysis and visualization of intracranial EEG data._ NeuroImage (2020) 223:117341

## License

The package is licensed under MPL-2.0 license. 

The purpose is to avoid virus-like copyleft licenses such as GPL. MPL-2.0 allows `three-brain-js` library to be *linked* as whole without forcing to change your own license (even it's proprietary). However, any redistribution of the original or modified copies outside your organizations shall be released under MPL-2.0 or more rigid open-source license. This is not a legal advice, nor the license itself, and may not cover important issues that affect you and your specific situation. As a result, please read the license itself, or seek legal advice from a lawyer for any questions.





