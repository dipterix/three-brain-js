import QrCodeWithLogo from 'qrcode-with-logos';
import { RAVELogo } from '../core/RAVELogo.js'

function registerPresetQRCode( ViewerControlCenter ) {
  ViewerControlCenter.prototype.addPreset_qrcode = function(){
    const qrctrl = this.gui.addController(
      'QR Code', () => {}
    );
    const $qrWrapper = document.createElement("div");
    $qrWrapper.style.width = "100%";
    const $qrA = document.createElement("a");
    $qrA.setAttribute("target", "_blank");
    $qrA.style.lineHeight = "var(--widget-height)";
    const $qr = document.createElement("canvas");
    const $qrB = document.createElement("a");
    $qrB.setAttribute("target", "_blank");
    $qrB.appendChild($qr);

    $qrWrapper.appendChild($qrA);
    $qrWrapper.appendChild($qrB);
    qrctrl.domElement.replaceChildren($qrWrapper);
    qrctrl.hide();

    this.setQRCode = (url, {
      text = "Scan to see the viewer",
      errorCorrectionLevel = "H",
      margin = 1,
      showImage = true,
      width = 250
    } = {}) => {
      qrctrl.hide();
      if(!url || typeof url !== "string") { return; }

      if( !url.startsWith("http") ) {
        url = `https://${url}`;
      }

      $qrA.innerHTML = "";
      $qrA.setAttribute("href", "#");
      $qrB.setAttribute("href", "#");

      new QrCodeWithLogo({
        canvas: $qr,
        content: url,
        width: width * ( this.canvas.pixel_ratio[0] || 1 ),
        download: false,
        logo: RAVELogo,
        nodeQrCodeOptions: {
          errorCorrectionLevel: errorCorrectionLevel,
          margin: margin,
        }
      })
      .getImage()
      .then(image => {
        $qr.style.width = "100%";
        $qr.style.height = "auto";

        $qrA.innerHTML = text;
        $qrA.setAttribute("href", url);
        qrctrl.show();

        if( showImage ) {
          $qrB.setAttribute("href", $qr.toDataURL());
          $qrB.style.display = "block";
        } else {
          $qrB.style.display = "hidden";
        }


        const folder = this.gui.getFolder("Default");
        folder.$children.style.height = "auto";
      })
      .catch( (error) => {
        qrctrl.hide();
        console.error(error);
      });

    };

    if( this.settings.qrcode ) {
      const qrcodeSettings = this.settings.qrcode;
      if( typeof qrcodeSettings === "object" ) {
        if( typeof qrcodeSettings.url === "string" ) {

          this.setQRCode( qrcodeSettings.url, qrcodeSettings );
        }
      } else if ( typeof qrcodeSettings === "string" ) {
        this.setQRCode( qrcodeSettings );
      }

    }
  };

  return( ViewerControlCenter );
}


export { registerPresetQRCode };
