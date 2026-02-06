_rotation = 0;
xi = this._x;
yi = this._y;
nf = this._parent.level * 2;
c = 0;
var p = 0;
while(p < 3)
{
   this._parent.attachMovie("fumee2","fumee2" + c + 100,c + 100);
   var f = this._parent["fumee2" + c + 100];
   f._x = this._x;
   f._y = this._y - 30;
   f.vx = this._x - xi + 20 * (Math.random() - 0.5);
   f.vy = this._y - yi + 20 * (Math.random() - 0.5);
   c++;
   xi = this._x;
   yi = this._y;
   p++;
}
