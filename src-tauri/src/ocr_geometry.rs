//! OCR geometry, independent of Python/OpenCV.
//! Border following adapted from imageproc 0.25.0 (MIT, Copyright 2015 PistonDevelopers).
//! See licenses/imageproc-contours-LICENSE.txt. The remaining geometry is implemented here.
use std::collections::VecDeque;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point { pub x: f64, pub y: f64 }
pub type Quad = [Point; 4];
impl Point {
    fn sub(self, other: Self) -> Self { Self { x: self.x-other.x, y: self.y-other.y } }
    fn dot(self, other: Self) -> f64 { self.x*other.x+self.y*other.y }
    pub fn distance(self, other: Self) -> f64 { (self.x-other.x).hypot(self.y-other.y) }
}
fn cross(a: Point, b: Point, c: Point) -> f64 { let u=b.sub(a); let v=c.sub(a); u.x*v.y-u.y*v.x }

/// Suzuki/Abe border following. A zero border also handles foreground touching the image edge.
/// RETR_LIST needs both exterior and hole contours, not just connected-component bounds.
fn contours(mask: &[bool], w: usize, h: usize, check: &dyn Fn()->Result<(),String>) -> Result<Vec<Vec<Point>>,String> {
    let stride=w+2;
    let mut labels=vec![0i32;(w+2)*(h+2)];
    for y in 0..h { for x in 0..w { labels[(y+1)*stride+x+1]=i32::from(mask[y*w+x]); } }
    let dirs=[(-1i32,0i32),(-1,-1),(0,-1),(1,-1),(1,0),(1,1),(0,1),(-1,1)];
    let direction=|a:(usize,usize),b:(usize,usize)|->Result<usize,String> {
        let d=(a.0 as i32-b.0 as i32,a.1 as i32-b.1 as i32);
        dirs.iter().position(|p|*p==d).ok_or_else(||"OCR contour direction is invalid".into())
    };
    let neighbor=|p:(usize,usize),i:usize|->(usize,usize) { ((p.0 as i32+dirs[i].0) as usize,(p.1 as i32+dirs[i].1) as usize) };
    let occupied=|a:&[i32],p:(usize,usize)| p.0<stride&&p.1<h+2&&a[p.1*stride+p.0]!=0;
    let mut borders=VecDeque::new(); let mut number=1i32;
    for y in 1..=h {
        if y%32==0 { check()?; }
        for x in 1..=w {
            let pos=y*stride+x;
            if labels[pos]==0 { continue; }
            let adjacent=if labels[pos]==1&&labels[pos-1]==0 { Some((x-1,y)) }
                else if labels[pos]>0&&labels[pos+1]==0 { Some((x+1,y)) } else { None };
            let Some(adjacent)=adjacent else { continue; };
            number+=1;
            let current=(x,y); let first_direction=direction(adjacent,current)?;
            let first=(0..8).map(|k|neighbor(current,(first_direction+k)%8)).find(|p|occupied(&labels,*p));
            let mut points=Vec::new();
            if let Some(first)=first {
                let mut previous=first; let mut point=current; let mut steps=0usize;
                loop {
                    let start=direction(previous,point)?;
                    let found=(0..8).map(|k|(start+7-k)%8).find(|i|occupied(&labels,neighbor(point,*i)))
                        .ok_or("OCR contour lost its boundary")?;
                    let next=neighbor(point,found);
                    let right_edge=(0..8).map(|k|(start+7-k)%8).take_while(|i|*i!=found).any(|i|i==4);
                    if point.0+1==stride || right_edge { labels[point.1*stride+point.0]=-number; }
                    else if labels[point.1*stride+point.0]==1 { labels[point.1*stride+point.0]=number; }
                    let p=Point{x:point.0 as f64-1.,y:point.1 as f64-1.};
                    // CHAIN_APPROX_SIMPLE: keep turns, not every pixel along a straight border.
                    if points.len()>=2 && cross(points[points.len()-2],points[points.len()-1],p)==0.
                        && points[points.len()-1].sub(points[points.len()-2]).dot(p.sub(points[points.len()-1]))>0. {
                        let n=points.len(); points[n-1]=p;
                    } else { points.push(p); }
                    steps+=1;
                    if steps%4096==0 { check()?; }
                    if steps>mask.len().saturating_mul(8) || points.len()>1_000_000 { return Err("OCR 轮廓过于复杂，请裁剪识别区域 / OCR contour is too complex; crop the region".into()); }
                    if next==current&&point==first { break; }
                    previous=point; point=next;
                }
            } else { points.push(Point{x:x as f64-1.,y:y as f64-1.}); labels[pos]=-number; }
            // OpenCV RETR_LIST returns reverse discovery order. Retain its last 1000 candidates.
            borders.push_back(points); if borders.len()>1000 { borders.pop_front(); }
        }
    }
    Ok(borders.into_iter().rev().collect())
}

fn hull(mut points:Vec<Point>)->Vec<Point> {
    points.sort_by(|a,b|a.x.total_cmp(&b.x).then(a.y.total_cmp(&b.y))); points.dedup();
    if points.len()<=2 { return points; }
    let mut chain=Vec::new();
    for p in &points { while chain.len()>=2&&cross(chain[chain.len()-2],chain[chain.len()-1],*p)<=0. { chain.pop(); } chain.push(*p); }
    let lower=chain.len();
    for p in points.iter().rev().skip(1) { while chain.len()>lower&&cross(chain[chain.len()-2],chain[chain.len()-1],*p)<=0. { chain.pop(); } chain.push(*p); }
    chain.pop(); chain
}
pub fn ordered(mut points:Quad)->Quad {
    points.sort_by(|a,b|a.x.total_cmp(&b.x));
    if points[0].y>points[1].y { points.swap(0,1); }
    if points[2].y>points[3].y { points.swap(2,3); }
    [points[0],points[2],points[3],points[1]]
}
fn rectangle(points:Vec<Point>,check:&dyn Fn()->Result<(),String>)->Result<Option<(Quad,f64)>,String> {
    let pts=hull(points); if pts.len()<3 { return Ok(None); }
    let mut best=None; let mut area=f64::INFINITY;
    for i in 0..pts.len() {
        if i%64==0 { check()?; }
        let d=pts[(i+1)%pts.len()].sub(pts[i]); let len=d.x.hypot(d.y); if len<1e-9 {continue;}
        let u=Point{x:d.x/len,y:d.y/len}; let v=Point{x:-u.y,y:u.x};
        let (mut x0,mut x1,mut y0,mut y1)=(f64::INFINITY,f64::NEG_INFINITY,f64::INFINITY,f64::NEG_INFINITY);
        for p in &pts { let x=p.dot(u); let y=p.dot(v); x0=x0.min(x);x1=x1.max(x);y0=y0.min(y);y1=y1.max(y); }
        let a=(x1-x0)*(y1-y0);
        if a<area { area=a; let p=|x:f64,y:f64|Point{x:x*u.x+y*v.x,y:x*u.y+y*v.y};
            best=Some((ordered([p(x0,y0),p(x1,y0),p(x1,y1),p(x0,y1)]),(x1-x0).min(y1-y0))); }
    }
    Ok(best)
}
fn score(map:&[f32],w:usize,h:usize,q:&Quad)->f64 {
    let x0=q.iter().map(|p|p.x.floor() as i64).min().unwrap_or(0).clamp(0,w as i64-1);
    let x1=q.iter().map(|p|p.x.ceil() as i64).max().unwrap_or(0).clamp(0,w as i64-1);
    let y0=q.iter().map(|p|p.y.floor() as i64).min().unwrap_or(0).clamp(0,h as i64-1);
    let y1=q.iter().map(|p|p.y.ceil() as i64).max().unwrap_or(0).clamp(0,h as i64-1);
    let width=(x1-x0+1) as usize; let height=(y1-y0+1) as usize;
    let pts:Vec<(i64,i64)>=q.iter().map(|p|((p.x-x0 as f64).trunc() as i64,(p.y-y0 as f64).trunc() as i64)).collect();
    let mut mask=vec![false;width*height];
    // Inclusive polygon scanlines plus integer boundary pixels.
    for y in 0..height {
        let mut xs=Vec::new();
        for k in 0..4 { let a=pts[k];let b=pts[(k+1)%4];
            if a.1!=b.1&&(y as i64)>=a.1.min(b.1)&&(y as i64)<=a.1.max(b.1) {
                xs.push(a.0 as f64+(y as f64-a.1 as f64)*(b.0-a.0) as f64/(b.1-a.1) as f64);
            }
        }
        if xs.len()>=2 { xs.sort_by(f64::total_cmp); let left=(xs[0].ceil() as i64).max(0); let right=(xs[xs.len()-1].floor() as i64).min(width as i64-1);
            if left<=right { for x in left..=right {mask[y*width+x as usize]=true;} }
        }
    }
    for k in 0..4 { let (mut x,mut y)=pts[k];let (ex,ey)=pts[(k+1)%4];
        let dx=(ex-x).abs();let sx=if x<ex{1}else{-1};let dy=-(ey-y).abs();let sy=if y<ey{1}else{-1};let mut err=dx+dy;
        loop { if x>=0&&y>=0&&x<width as i64&&y<height as i64 {mask[y as usize*width+x as usize]=true;}
            if x==ex&&y==ey{break;}let e=2*err;if e>=dy{err+=dy;x+=sx;}if e<=dx{err+=dx;y+=sy;}
        }
    }
    let mut total=0.;let mut n=0;
    for y in 0..height {for x in 0..width{if mask[y*width+x]{total+=map[(y+y0 as usize)*w+x+x0 as usize] as f64;n+=1;}}}
    if n==0{0.}else{total/n as f64}
}

pub fn boxes(map:&[f32],w:usize,h:usize,original_w:u32,original_h:u32,check:&dyn Fn()->Result<(),String>)->Result<Vec<Quad>,String> {
    if w==0||h==0||map.len()!=w*h||map.iter().any(|v|!v.is_finite()){return Err("OCR 检测张量无效 / Invalid OCR detection tensor".into());}
    let mut mask=vec![false;map.len()];
    // OpenCV 2x2 dilation, default anchor (1,1), zero border.
    for y in 0..h {if y%64==0{check()?;}for x in 0..w{
        mask[y*w+x]=map[y*w+x]>0.3||(x>0&&map[y*w+x-1]>0.3)||(y>0&&map[(y-1)*w+x]>0.3)||(x>0&&y>0&&map[(y-1)*w+x-1]>0.3);
    }}
    let mut out=Vec::new();
    for contour in contours(&mask,w,h,check)? {
        check()?;
        let Some((q,side))=rectangle(contour,check)? else {continue;};
        if side<3.||score(map,w,h,&q)<0.5{continue;}
        let a=q[0].distance(q[1]);let b=q[0].distance(q[3]);if a<1e-9||b<1e-9{continue;}
        // DB unclip is applied to the minimum rectangle, not the original polygon.
        // Its rounded Minkowski offset has min-rectangle dimensions (a+2d,b+2d).
        // Unlike integer PyClipper, this preserves subpixel coordinates until final scaling.
        let d=a*b*1.6/(2.*(a+b)); if side+2.*d<5.{continue;}
        let u=q[1].sub(q[0]);let v=q[3].sub(q[0]);
        let mut expanded=q;
        for (i,(su,sv)) in [(-1.,-1.),(1.,-1.),(1.,1.),(-1.,1.)].iter().enumerate(){
            expanded[i].x+=d*(su*u.x/a+sv*v.x/b);expanded[i].y+=d*(su*u.y/a+sv*v.y/b);
            expanded[i].x=(expanded[i].x/w as f64*original_w as f64).round_ties_even().clamp(0.,original_w.saturating_sub(1) as f64);
            expanded[i].y=(expanded[i].y/h as f64*original_h as f64).round_ties_even().clamp(0.,original_h.saturating_sub(1) as f64);
        }
        let q=ordered(expanded);
        if q[0].distance(q[1]).trunc()>3.&&q[0].distance(q[3]).trunc()>3.{out.push(q);}
    }
    out.sort_by(|a,b|a[0].y.total_cmp(&b[0].y).then(a[0].x.total_cmp(&b[0].x)));
    // Retain the baseline's single adjacent-row correction, not a new layout heuristic.
    for i in 0..out.len().saturating_sub(1){if (out[i+1][0].y-out[i][0].y).abs()<10.&&out[i+1][0].x<out[i][0].x{out.swap(i,i+1);}}
    Ok(out)
}

/// Inverse homography from the destination rectangle to its source quadrilateral.
pub fn homography(q:&Quad,w:f64,h:f64)->Result<[f64;8],String> {
    let dest=[(0.,0.),(w,0.),(w,h),(0.,h)]; let mut a=[[0f64;9];8];
    for (i,((x,y),p)) in dest.into_iter().zip(q).enumerate(){
        a[2*i]=[x,y,1.,0.,0.,0.,-p.x*x,-p.x*y,p.x];
        a[2*i+1]=[0.,0.,0.,x,y,1.,-p.y*x,-p.y*y,p.y];
    }
    for c in 0..8{
        let pivot=(c..8).max_by(|i,j|a[*i][c].abs().total_cmp(&a[*j][c].abs())).unwrap_or(c);
        if a[pivot][c].abs()<1e-10{return Err("OCR 文字框退化 / Degenerate OCR text box".into());}
        a.swap(c,pivot);let factor=a[c][c];for k in c..9{a[c][k]/=factor;}
        for r in 0..8{if r!=c{let factor=a[r][c];for k in c..9{a[r][k]-=factor*a[c][k];}}}
    }
    Ok(std::array::from_fn(|i|a[i][8]))
}
