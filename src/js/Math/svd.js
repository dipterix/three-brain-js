import { Vector3, Matrix4, Quaternion } from 'three';
// Pure JavaScript SVD algorithm.
// Input: 2-D list (m by n) with m >= n
// Output: U,W V so that A = U*W*VT
//
// -   Translated from python code by TANG ZhiXiong
// -   GitHub: https://github.com/district10/svd.js
// -   Origin: http://stitchpanorama.sourceforge.net/Python/svd.py
// -   FYI: http://stackoverflow.com/questions/960060/singular-value-decomposition-svd-in-php
//
// Usage:
//        var a = [
//            [22.,10., 2.,  3., 7.],
//            [14., 7.,10.,  0., 8.],
//            [-1.,13.,-1.,-11., 3.],
//            [-3.,-2.,13., -2., 4.],
//            [ 9., 8., 1., -2., 4.],
//            [ 9., 1.,-7.,  5.,-1.],
//            [ 2.,-6., 6.,  5., 1.],
//            [ 4., 5., 0., -2., 2.]
//        ];
//        var ret = svd(a);
//        var u, w, v;
//        if (ret) {
//            u = ret[0];
//            w = ret[1];
//            v = ret[2];
//            _print(a);
//            _print(_mult(_mult(u,_diag(w)), _trans(v)));
//        }

//
var _zeros = function(m, n) {
    var arr = [];
    for (var i = 0; i < m; ++i) {
        if (n === undefined) {
            arr.push(0.0);
        } else {
            var row = [];
            for (var j = 0; j < n; ++j) {
                row.push(0.0);
            }
            arr.push(row);
        }
    }
    return arr;
};

//
var _clone = function (a) {
    var m = a.length,
        n = a[0].length;
    var b = [];
    for (var i = 0; i < m; ++i) {
        var row = [];
        for (var j = 0; j < n; ++j) {
            row.push(a[i][j]);
        }
        b.push(row);
    }
    return b;
};

var _trans = function (a) {
    var m = a.length,
        n = a[0].length;
    var b = [];
    for (var i = 0; i < n; ++i) {
        var row = [];
        for (var j = 0; j < m; ++j) {
            row.push(a[j][i]);
        }
        b.push(row);
    }
    return b;
};

//
var _diff = function(a, b) {
    var m = a.length,
        n = a[0].length;
    var c = _zeros(m,n);
    for (var i = 0; i < m; ++i) {
        for (var j = 0; j < n; ++j) {
            c[i][j] = a[i][j] - b[i][j];
        }
    }
    return c;
};

//
var _mult = function (a, b) {
    // Multiply two matrices
    // a must be two dimensional
    // b can be one or two dimensional
    var am = a.length,
        bm = b.length,
        an = a[0].length,
        bn;
    if (Array.isArray(b[0])) {
        bn = b[0].length;
    } else {
        bn = 1;
    }
    if (an !== bm) {
        // raise ValueError, 'matrixmultiply error: array sizes do not match.'
        return;
    }
    var cm = am,
        cn = bn;
    var c;
    if (bn === 1) {
        c = _zeros(cm);
    } else {
        c = _zeros(cm,cn);
    }
    for (var i = 0; i < cm; ++i) {
        for (var j = 0; j < cn; ++j) {
            for (var k = 0; k < an; ++k) {
                if (bn === 1) {
                    c[i] += a[i][k]*b[k];
                } else {
                    c[i][j] += a[i][k]*b[k][j];
                }
            }
        }
    }
    return c;
};

//
var _diag = function(arr) {
    var n = arr.length;
    var ret = _zeros(n,n);
    for (var i = 0; i < n; ++i) {
        ret[i][i] = arr[i];
    }
    return ret;
};

//
var _toStr = function(a, before, after) {
    var before = before || "",
        after  = after || "";
    return before + a.map(function(r){
            if (Array.isArray(r)) {
                return r.map(function(e){ return (e).toFixed(4); }).join(", ");
            } else {
                return (r).toFixed(4);
            }
        }).join("\n") + after;
};

//
var _print = function(a, before, after) {
    var str;
    if (Array.isArray(a)) {
        str = _toStr(a,before,after);
    } else {
        str = a;
    }
    console.log(str);
    if (_writeDoc === true && _document !== undefined) {
        _document += (str+"\n");
    }
};

//
var _pythag = function(a, b) {
    var absa = Math.abs(a),
        absb = Math.abs(b);
    if (absa > absb) {
        return absa*Math.sqrt(1.0+(absb/absa)*(absb/absa));
    } else {
        if (absb === 0.0) {
            return 0.0;
        }  else {
            return absb*Math.sqrt(1.0+(absa/absb)*(absa/absb));
        }
    }
};

var svd_old = function (a, options) {
    // a is m by n, and m >= n

    // Golub and Reinsch state that eps should not be smaller than the
    // machine precision, ie the smallest number
    // for which 1+e>1.  tol should be beta/e where beta is the smallest
    // positive number representable in the computer.
    var options = options || {};
    var eps = options.eps || Number.EPSILON,
        tol = options.tol || Number.MIN_VALUE/eps;
    if (1.0+eps<=1.0 || tol <= 0.0) {
        return null;
    }
    var itmax = options.itmax || 50;
    var transposed = false;
    if (!Array.isArray(a) || !Array.isArray(a[0])) {
        return null;
    }
    var m = a.length,
        n = a[0].length;
    if (!(m >= n && n > 1)) {
        if (options.robust === true && m < n && m > 1) {
            // we can be robust here
            a = _trans(a);
            m = a.length;
            n = a[0].length;
            transposed = true;
        } else {
            // can't save you
            return null;
        }
    }
    var u = _clone(a);

    var e = _zeros(n),
        q = _zeros(n),
        v = _zeros(n,n);

    // Householder's reduction to bidiagonal form
    var g = 0.0,
        x = 0.0;

    for (var i = 0; i < n; ++i) {
        e[i] = g;
        var s = 0.0,
            l = i+1;
        for (var j = i; j < m; ++j) {
            s += u[j][i]*u[j][i];
        }
        if (s <= tol) {
            g = 0.0;
        } else {
            var f = u[i][i];
            if (f < 0.0) {
                g =  Math.sqrt(s);
            } else {
                g = -Math.sqrt(s);
            }
            var h = f*g-s;
            u[i][i] = f-g;
            for (var j = l; j < n; ++j) {
                s = 0.0;
                for (var k = i; k < m; ++k) {
                    s += u[k][i]*u[k][j];
                }
                f = s / h;
                for (var k = i; k < m; ++k) {
                    u[k][j] += f*u[k][i];
                }
            }
        }
        q[i] = g;
        s = 0.0;
        for (var j = l; j < n; ++j) {
            s += u[i][j]*u[i][j];
        }
        if (s <= tol) {
            g = 0.0;
        } else {
            f = u[i][i+1];
            if (f < 0.0) {
                g =  Math.sqrt(s)
            } else {
                g = -Math.sqrt(s);
            }
            h = f*g-s;
            u[i][i+1] = f-g;
            for (var j = l; j < n; ++j) {
                e[j] = u[i][j]/h;
            }
            s = 0.0;
            for (var k = l; k < n; ++k) {
                s += u[j][k]*u[i][k];
            }
            for (var k = l; k < n; ++k) {
                u[j][k] += s*e[k];
            }
        }
        var y = Math.abs(q[i])+Math.abs(e[i]);
        if (y > x) { x = y; }
    }

    // accumulation of right hand gtransformations
    for (var i = n-1; i >= 0; --i) {
        if (g != 0.0) {
            h = g*u[i][i+1]
            for (var j = l; j < n; ++j) {
                v[j][i] = u[i][j]/h;
            }
            for (var j = l; j < n; ++j) {
                s = 0.0;
                for (var k = l; k < n; ++k) {
                    s += (u[i][k]*v[k][j]);
                }
                for (var k = l; k < n; ++k) {
                    v[k][j] += s*v[k][i];
                }
            }
        }
        for (var j = l; j < n; ++j) {
            v[i][j] = 0.0;
            v[j][i] = 0.0;
        }
        v[i][i] = 1.0;
        g = e[i];
        l = i;
    }

    // accumulation of left hand transformations
    for (var i = n-1; i >= 0; --i) {
        l = i+1;
        g = q[i];
        for (var j = l; j < n; ++j) {
            u[i][j] = 0.0;
        }
        if (g != 0.0) {
            h = u[i][i]*g;
            for (var j = l; j < n; ++j) {
                s = 0.0;
                for (var k = l; k < m; ++k) {
                    s += u[k][i]*u[k][j];
                }
                f = s/h;
                for (var k = i; k < m; ++k) {
                    u[k][j] += f*u[k][i];
                }
            }
            for (var j = i; j < m; ++j) {
                u[j][i] /= g;
            }
        } else {
            for (var j = i; j < m; ++j) {
                u[j][i] = 0.0;
            }
        }
        u[i][i] += 1.0;
    }

    // diagonalization of the bidiagonal form
    eps *= x;
    for (var k = n-1; k >= 0; --k) {
        for (var iteration = 0; iteration < itmax; ++iteration) {
            var goto_test_f_convergence = true;
            // test f splitting
            for (var l = k; l >= 0; --l) {
                goto_test_f_convergence = false;
                if (Math.abs(e[l]) <= eps) {
                    // goto test f convergence
                    goto_test_f_convergence = true;
                    break; // break out of l loop
                }
                if (Math.abs(q[l-1]) <= eps) {
                    // goto cancellation
                    break; // break out of l loop
                }
            }
            if (!goto_test_f_convergence) {
                // cancellation of e[l] if l>0
                var c = 0.0,
                    s = 1.0,
                    l1 = l-1;
                for (var i = l; i <= k; ++i) {
                    f = s*e[i];
                    e[i] = c*e[i];
                    if (Math.abs(f) <= eps) {
                        // goto test f convergence
                        break;
                    }
                    g = q[i];
                    h = _pythag(f,g);
                    q[i] = h;
                    c =  g/h;
                    s = -f/h;
                    for (var j = 0; j < m; ++j) {
                        y = u[j][l1];
                        var z = u[j][i];
                        u[j][l1] = y*c+z*s;
                        u[j][i] = -y*s+z*c;
                    }
                }
            }
            // test f convergence
            z = q[k];
            if (l === k) {
                // convergence
                if (z < 0.0) {
                    // q[k] is made non-negative
                    q[k] = -z;
                    for (var j = 0; j < n; ++j) {
                        v[j][k] *= -1;
                    }
                }
                break; // break out of iteration loop and move on to next k value
            }
            if (iteration >= itmax-1) {
                // if __debug__: print 'Error: no convergence.'
                // should this move on the the next k or exit with error??
                // raise ValueError,'SVD Error: No convergence.'  # exit the program with error
                break; // break out of iteration loop and move on to next k
            }
            // shift from bottom 2x2 minor
            x = q[l];
            y = q[k-1];
            g = e[k-1];
            h = e[k];
            f = ((y-z)*(y+z)+(g-h)*(g+h))/(2.0*h*y);
            g = _pythag(f,1.0);
            if (f < 0) {
                f = ((x-z)*(x+z)+h*(y/(f-g)-h))/x;
            } else {
                f = ((x-z)*(x+z)+h*(y/(f+g)-h))/x;
            }
            // next QR transformation
            c = 1.0;
            s = 1.0;
            for (var i = l+1; i <= k; ++i) {
                g = e[i];
                y = q[i];
                h = s*g;
                g = c*g;
                z = _pythag(f,h);
                e[i-1] = z;
                c = f/z;
                s = h/z;
                f = x*c+g*s;
                g = -x*s+g*c;
                h = y*s;
                y = y*c;
                for (var j = 0; j < n; ++j) {
                    x = v[j][i-1];
                    z = v[j][i];
                    v[j][i-1] = x*c+z*s;
                    v[j][i] = -x*s+z*c;
                }
                z = _pythag(f,h);
                q[i-1] = z;
                c = f/z;
                s = h/z;
                f = c*g+s*y;
                x = -s*g+c*y;
                for (var j = 0; j < m; ++j) {
                    y = u[j][i-1];
                    z = u[j][i];
                    u[j][i-1] = y*c+z*s;
                    u[j][i] = -y*s+z*c;
                }
            }
            e[l] = 0.0;
            e[k] = f;
            q[k] = x;
            // goto test f splitting
        }
    }

    // satisfy: a = u*w*vt, with w = _diag(q), vt = _trans(v), notice that u is not square
    return [u,q,v, transposed];
};

function svd(a, { withu, withv, eps, tol } = {}) {
  // Define default parameters
  withu = withu !== undefined ? withu : true;
  withv = withv !== undefined ? withv : true;
  eps = eps || Math.pow(2, -52);
  tol = 1e-64 / eps;

  // throw error if a is not defined
  if (!a) {
    throw new TypeError('Matrix a is not defined');
  }

  // Householder's reduction to bidiagonal form

  const n = a[0].length;
  const m = a.length;

  if (m < n) {
    throw new TypeError('Invalid matrix: m < n');
  }

  let i, j, k, l, l1, c, f, g, h, s, x, y, z;

  g = 0;
  x = 0;
  const e = [];

  const u = [];
  const v = [];

  const mOrN = (withu === 'f') ? m : n;

  // Initialize u
  for (i = 0; i < m; i++) {
    u[i] = new Array(mOrN).fill(0);
  }

  // Initialize v
  for (i = 0; i < n; i++) {
    v[i] = new Array(n).fill(0);
  }

  // Initialize q
  const q = new Array(n).fill(0);

  // Copy array a in u
  for (i = 0; i < m; i++) {
    for (j = 0; j < n; j++) {
      u[i][j] = a[i][j];
    }
  }

  for (i = 0; i < n; i++) {
    e[i] = g;
    s = 0;
    l = i + 1;
    for (j = i; j < m; j++) {
      s += Math.pow(u[j][i], 2);
    }
    if (s < tol) {
      g = 0;
    } else {
      f = u[i][i];
      g = f < 0 ? Math.sqrt(s) : -Math.sqrt(s);
      h = f * g - s;
      u[i][i] = f - g;
      for (j = l; j < n; j++) {
        s = 0;
        for (k = i; k < m; k++) {
          s += u[k][i] * u[k][j];
        }
        f = s / h;
        for (k = i; k < m; k++) {
          u[k][j] = u[k][j] + f * u[k][i];
        }
      }
    }
    q[i] = g;
    s = 0;
    for (j = l; j < n; j++) {
      s += Math.pow(u[i][j], 2);
    }
    if (s < tol) {
      g = 0;
    } else {
      f = u[i][i + 1];
      g = f < 0 ? Math.sqrt(s) : -Math.sqrt(s);
      h = f * g - s;
      u[i][i + 1] = f - g;
      for (j = l; j < n; j++) {
        e[j] = u[i][j] / h;
      }
      for (j = l; j < m; j++) {
        s = 0;
        for (k = l; k < n; k++) {
          s += u[j][k] * u[i][k];
        }
        for (k = l; k < n; k++) {
          u[j][k] = u[j][k] + s * e[k];
        }
      }
    }
    y = Math.abs(q[i]) + Math.abs(e[i])
    if (y > x) {
      x = y;
    }
  }

  // Accumulation of right-hand transformations
  if (withv) {
    for (i = n - 1; i >= 0; i--) {
      if (g !== 0) {
        h = u[i][i + 1] * g;
        for (j = l; j < n; j++) {
          v[j][i] = u[i][j] / h;
        }
        for (j = l; j < n; j++) {
          s = 0
          for (k = l; k < n; k++) {
            s += u[i][k] * v[k][j];
          }
          for (k = l; k < n; k++) {
            v[k][j] = v[k][j] + s * v[k][i];
          }
        }
      }
      for (j = l; j < n; j++) {
        v[i][j] = 0;
        v[j][i] = 0;
      }
      v[i][i] = 1;
      g = e[i];
      l = i;
    }
  }

  // Accumulation of left-hand transformations
  if (withu) {
    if (withu === 'f') {
      for (i = n; i < m; i++) {
        for (j = n; j < m; j++) {
          u[i][j] = 0;
        }
        u[i][i] = 1;
      }
    }
    for (i = n - 1; i >= 0; i--) {
      l = i + 1;
      g = q[i];
      for (j = l; j < mOrN; j++) {
        u[i][j] = 0;
      }
      if (g !== 0) {
        h = u[i][i] * g;
        for (j = l; j < mOrN; j++) {
          s = 0
          for (k = l; k < m; k++) {
            s += u[k][i] * u[k][j];
          }
          f = s / h
          for (k = i; k < m; k++) {
            u[k][j] = u[k][j] + f * u[k][i];
          }
        }
        for (j = i; j < m; j++) {
          u[j][i] = u[j][i] / g;
        }
      } else {
        for (j = i; j < m; j++) {
          u[j][i] = 0;
        }
      }
      u[i][i] = u[i][i] + 1;
    }
  }

  // Diagonalization of the bidiagonal form
  eps = eps * x;
  let testConvergence;
  for (k = n - 1; k >= 0; k--) {
    for (let iteration = 0; iteration < 50; iteration++) {
      // test-f-splitting
      testConvergence = false;
      for (l = k; l >= 0; l--) {
        if (Math.abs(e[l]) <= eps) {
          testConvergence = true;
          break;
        }
        if (Math.abs(q[l - 1]) <= eps) {
          break;
        }
      }

      if (!testConvergence) { // cancellation of e[l] if l>0
        c = 0;
        s = 1;
        l1 = l - 1;
        for (i = l; i < k + 1; i++) {
          f = s * e[i];
          e[i] = c * e[i];
          if (Math.abs(f) <= eps) {
            break; // goto test-f-convergence
          }
          g = q[i];
          q[i] = Math.sqrt(f * f + g * g);
          h = q[i];
          c = g / h;
          s = -f / h;
          if (withu) {
            for (j = 0; j < m; j++) {
              y = u[j][l1];
              z = u[j][i];
              u[j][l1] = y * c + (z * s);
              u[j][i] = -y * s + (z * c);
            }
          }
        }
      }

      // test f convergence
      z = q[k];
      if (l === k) { // convergence
        if (z < 0) {
          // q[k] is made non-negative
          q[k] = -z;
          if (withv) {
            for (j = 0; j < n; j++) {
              v[j][k] = -v[j][k];
            }
          }
        }
        break; // break out of iteration loop and move on to next k value
      }

      // Shift from bottom 2x2 minor
      x = q[l];
      y = q[k - 1];
      g = e[k - 1];
      h = e[k];
      f = ((y - z) * (y + z) + (g - h) * (g + h)) / (2 * h * y);
      g = Math.sqrt(f * f + 1);
      f = ((x - z) * (x + z) + h * (y / (f < 0 ? (f - g) : (f + g)) - h)) / x;

      // Next QR transformation
      c = 1;
      s = 1;
      for (i = l + 1; i < k + 1; i++) {
        g = e[i];
        y = q[i];
        h = s * g;
        g = c * g;
        z = Math.sqrt(f * f + h * h);
        e[i - 1] = z;
        c = f / z;
        s = h / z;
        f = x * c + g * s;
        g = -x * s + g * c;
        h = y * s;
        y = y * c;
        if (withv) {
          for (j = 0; j < n; j++) {
            x = v[j][i - 1];
            z = v[j][i];
            v[j][i - 1] = x * c + z * s;
            v[j][i] = -x * s + z * c;
          }
        }
        z = Math.sqrt(f * f + h * h);
        q[i - 1] = z;
        c = f / z;
        s = h / z;
        f = c * g + s * y;
        x = -s * g + c * y;
        if (withu) {
          for (j = 0; j < m; j++) {
            y = u[j][i - 1];
            z = u[j][i];
            u[j][i - 1] = y * c + z * s;
            u[j][i] = -y * s + z * c;
          }
        }
      }
      e[l] = 0;
      e[k] = f;
      q[k] = x;
    }
  }

  // Number below eps should be zero
  for (i = 0; i < n; i++) {
    if (q[i] < eps) {
      q[i] = 0;
    }
  }

  // decreasing by eigen values
  const dd = q.map((v, i) => { return [v, i]; });
  dd.sort((a, b) => { return( - a[0] + b[0] ); });
  const o = dd.map((el) => { return el[1]; });

  return { u, q, v, o };
}

function registerRigidPoints( pointSet1 , pointSet2 ) {
  const nPoints = Math.min( pointSet1.length, pointSet2.length );
  const pointSize = 3;
  if( nPoints < pointSize ) {
    throw new TypeError("Insufficient number of points to calculate transform.");
  }
  let i, j, k, l;

  // mean
  const mean1 = new Vector3();
  const mean2 = new Vector3();

  // center pointSet1 & 2
  const x = [];
  const y = [];

  for(i = 0; i < nPoints; i++) {
    const p1 = pointSet1[i];
    const p2 = pointSet2[i];
    mean1.add( p1 );
    mean2.add( p2 );
    x.push( p1.clone() );
    y.push( p2.clone() );
  }
  mean1.multiplyScalar( 1/ nPoints );
  mean2.multiplyScalar( 1/ nPoints );

  for(i = 0; i < nPoints; i++) {
    x[i].sub( mean1 );
    y[i].sub( mean2 );
  }

  // console.log(x);
  // console.log(y);

  // matrix 3x3 rows <- crossprod(x, y)
  const m33_1 = [0, 0, 0];
  const m33_2 = [0, 0, 0];
  const m33_3 = [0, 0, 0];
  for(i = 0; i < nPoints; i++) {
    const xi = x[i];
    const yi = y[i];
    m33_1[0] += xi.x * yi.x;
    m33_1[1] += xi.x * yi.y;
    m33_1[2] += xi.x * yi.z;

    m33_2[0] += xi.y * yi.x;
    m33_2[1] += xi.y * yi.y;
    m33_2[2] += xi.y * yi.z;

    m33_3[0] += xi.z * yi.x;
    m33_3[1] += xi.z * yi.y;
    m33_3[2] += xi.z * yi.z;
  }
  // console.log([m33_1, m33_2, m33_3]);
  const svdRes = svd([m33_1, m33_2, m33_3], { robust : true });
  // console.log(svdRes);
  const d = svdRes.q;
  const u = svdRes.u;
  const v = svdRes.v;

  const udv = [
    [ d[0], u[0][0], u[1][0], u[2][0], v[0][0], v[1][0], v[2][0] ],
    [ d[1], u[0][1], u[1][1], u[2][1], v[0][1], v[1][1], v[2][1] ],
    [ d[2], u[0][2], u[1][2], u[2][2], v[0][2], v[1][2], v[2][2] ],
  ];

  // decreasing by eigen values
  udv.sort((a, b) => { return( - a[0] + b[0] ); });

  const m44_uTrans = new Matrix4().set(
    udv[0][1], udv[0][2], udv[0][3], 0,
    udv[1][1], udv[1][2], udv[1][3], 0,
    udv[2][1], udv[2][2], udv[2][3], 0,
    0, 0, 0, 1
  );

  // v
  const m44 = new Matrix4().set(
    udv[0][4], udv[1][4], udv[2][4], 0,
    udv[0][5], udv[1][5], udv[2][5], 0,
    udv[0][6], udv[1][6], udv[2][6], 0,
    0, 0, 0, 1
  );
  if( m44.determinant() * m44_uTrans.determinant() < 0 ) {
    // this happens when control pointSets are not fully ranked
    // The last eigenvalue of `D` is 0, hence d_3 * U_3 %*% t(V_3) is 0 and
    // the signs of 3rd columns of U and V can be flipped and everything
    // could be still fine
    // in such case, rotation = V x diag([1,1,-1]) x t(U), or simply flip
    // one of the 3rd columns of U and V

    // flip the 3rd column of v here
    const e = m44.elements; // 3js is column-major
    e[8] = -e[8];
    e[9] = -e[9];
    e[10] = -e[10];
  }

  // v x t(u)
  m44.multiply( m44_uTrans );

  // translation
  mean2.sub( mean1.applyMatrix4( m44 ) );
  m44.setPosition( mean2 );

  return m44;

}

/**
 * fixedFrom and fixedTo are Vector3, the fixedFrom will be positioned at fixedTo after mapping
 * dirFrom, dirTo are Vector3, for DBS electrodes, optional
 */
function registerRigidPoints2( fromPoints, toPoints, fixedFrom, fixedTo, dirFrom, dirTo ) {
  const nPoints = Math.min( pointSet1.length, pointSet2.length );
  if( nPoints < 2 ) {
    throw new TypeError("Insufficient number of points to calculate transform.");
  }
  let i, j, k, l;

  // mean
  const mean1 = new Vector3();
  const mean2 = new Vector3();

  // center fromPoints & toPoints
  const x = [];
  const y = [];

  for(i = 0; i < nPoints; i++) {
    const p1 = fromPoints[i];
    const p2 = toPoints[i];
    mean1.add( p1 );
    mean2.add( p2 );
    x.push( p1.clone() );
    y.push( p2.clone() );
  }
  mean1.multiplyScalar( 1/ nPoints );
  mean2.multiplyScalar( 1/ nPoints );

  const dir1 = mean1.clone().sub( fixedFrom ).normalize(),
        dir2 = mean2.clone().sub( fixedTo ).normalize();
        probeDirection = dir2.clone();

  const quaternion = new Quaternion();

  const rotationAxis = new Vector3().crossVectors(dir1, dir2);
  if( rotationAxis.length() > 0.0001 ) {

    const angle = Math.acos( dir1.dot( dir2 ) );

    quaternion.setFromAxisAngle( rotationAxis , angle );

  }

  if( dirFrom && dirTo && dirFrom.lengthSq() > 0 && dirTo.lengthSq() > 0 ) {
    dir1.copy( dirFrom ).normalize()
      .applyQuaternion( quaternion )
      .cross( probeDirection ).cross( probeDirection )
      .multiplyScalar( -1 ).normalize();

    dir2.copy( dirTo ).normalize()
      .cross( probeDirection ).cross( probeDirection )
      .multiplyScalar( -1 ).normalize();

    rotationAxis.crossVectors(dir1, dir2);

    if( rotationAxis.length() > 0.0001 ) {

      const angle = Math.acos( dir1.dot( dir2 ) );
      quaternion.premultiply(
        new Quaternion().setFromAxisAngle( rotationAxis , angle )
      );

    }
  }

  dir1.set(0, 0, 0).sub( fixedFrom ).applyQuaternion( quaternion ).add( fixedTo );
  dir2.set(0, 0, 0);
  const m44 = new Matrix4().compose( dir1, quaternion, dir2 );

  return m44
}


/**
 * Calculates angle sizes for a triangle
 */
function triangleArc ( a, b, c ) {


  if ( Math.min(a, b, c) <= 0 || (a + b) < c || Math.abs( a - b ) > c ) {
    throw new RangeError("triangleArc: invalid triangle edge size");
  }
  const a2 = a * a;
  const b2 = b * b;
  const c2 = c * c;

  const A = Math.acos( (b2 + c2 - a2) / (b * c * 2) );
  const B = Math.acos( (a2 + c2 - b2) / (a * c * 2) );
  let C = Math.PI - A - B;
  if( C < 0 ) { C = 0; }
  return {
    angle: [A, B, C],
    edgeSize: [a, b, c]
  }
}

function pointPositionByDistances( positions, distances ) {
  // positions must be an array of 3 points with no linearity
  // https://math.stackexchange.com/questions/1948835/how-can-i-calculate-a-points-coordinates-given-distances-from-three-other-known

  // positions is [vec3, vec3, vec3]
  // distances is [d1, d2, d3]
  const d1 = distances[0],
        d2 = distances[1],
        d3 = distances[2];
  const A = []
  const p1 = positions[0].clone();
  const p2 = positions[1].clone();
  const p3 = positions[2];
  A.push( [
    2. * ( p2.x - p1.x ),
    2. * ( p2.y - p1.y ),
    2. * ( p2.z - p1.z ),
    p1.lengthSq() - d1 * d1 - p2.lengthSq() + d2 * d2
  ] );

  A.push( [
    2. * ( p3.x - p1.x ),
    2. * ( p3.y - p1.y ),
    2. * ( p3.z - p1.z ),
    p1.lengthSq() - d1 * d1 - p3.lengthSq() + d3 * d3
  ] );

  // in 3D space, the new point is also within the plan formed by 3 points
  p1.sub( p3 ).cross( p2.sub( p3 ) );

  A.push( [ p1.x, p1.y, p1.z, - p1.dot( p3 ) ]);

  A.push([0, 0, 0, 0]);

  const svdRes = svd( A );

  const v = svdRes.v;
  let o = svdRes.o.indexOf(3);
  if( Math.abs(v[3][o]) < 1e-6 ) {
    o = svdRes.o.indexOf(2);
  }
  p1.set( v[0][o], v[1][o], v[2][o] ).multiplyScalar( 1. / v[3][o] );

  return p1;
}


export { svd, registerRigidPoints, registerRigidPoints2, pointPositionByDistances };
