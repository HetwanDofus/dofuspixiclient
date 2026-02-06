p = 0;
while(p < 7)
{
   this.attachMovie("fumee","fumee" + c,c);
   eval("this.fumee" + c).vx = 180 * (Math.random() - 0.5);
   eval("this.fumee" + c).vy = 180 * (Math.random() - 0.5);
   c++;
   p++;
}
