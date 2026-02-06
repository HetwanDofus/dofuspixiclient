i = 1;
while(i < 20)
{
   this.attachMovie("feux","feux" + i,i);
   i++;
}
i = 1;
while(i < 10)
{
   _parent.attachMovie("plumes2","plumes2" + i,i);
   eval("_parent.plumes2" + i).plume._x = _X;
   eval("_parent.plumes2" + i).plume._y = _Y;
   i++;
}
g = 0;
vy = 0;
vx = 0;
