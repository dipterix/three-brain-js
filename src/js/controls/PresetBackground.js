import { CONSTANTS } from '../core/constants.js';

// 1. Background colors

function registerPresetBackground( ViewerControlCenter ){

  ViewerControlCenter.prototype.addPreset_background = function(){
    const initialValue = this.settings.background || "#ffffff",
          folderName = CONSTANTS.FOLDERS['background-color'];

    const citation = this.gui.addController(
      'Viewer Citation Information', () => {}
    )
    // replace
    const $a = document.createElement("a");
    $a.innerText = 'See rave.wiki for citation information';
    $a.setAttribute("href", "https://rave.wiki/");
    $a.setAttribute("target", "_blank");
    $a.style.lineHeight = "var(--widget-height)";
    citation.domElement.replaceChildren($a);

    const controller = this.gui.addController(
      'Background Color', '#FFFFFF',
      { isColor : true, folderName: folderName }
    )
      .onChange((v) => { this.canvas.setBackground({ color : v }); })
      .setValue( initialValue );

  }

  return( ViewerControlCenter );

}

export { registerPresetBackground };
